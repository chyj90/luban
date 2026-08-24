#!/usr/bin/env python3
"""
将 OWL ABox（实例数据）导入关系型数据库。
用法: python import_owl_abox.py <owl_file> [--db mysql|postgres] [--output sql_file]
"""

import re
import argparse
from collections import defaultdict
from rdflib import Graph, RDF, URIRef, Literal


def sanitize_value(val):
    """清理字符串值，去除换行并转义"""
    s = str(val).replace('\n', ' ').replace('\r', '').strip()
    return s.replace("'", "''")


def generate_sql(owl_path, db_type='mysql'):
    import xml.etree.ElementTree as ET

    # 从 XML 提取命名空间映射（ElementTree 不把 xmlns 放在 attrib 里，需用 iterparse）
    ns_map = {'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
              'owl': 'http://www.w3.org/2002/07/owl#'}
    for event, (prefix, ns_uri) in ET.iterparse(owl_path, events=['start-ns']):
        if prefix:
            ns_map[prefix] = ns_uri

    # 构建反向映射: namespace_uri -> prefix
    ns_reverse = {v: k for k, v in ns_map.items() if k}

    # 辅助函数: 将 URI 缩短为 prefix:localname
    def shorten(uri_str):
        for ns_uri, pfx in ns_reverse.items():
            if uri_str.startswith(ns_uri):
                return pfx, uri_str[len(ns_uri):]
        return None, uri_str

    def to_name(uri_str):
        """将 URI 转为合法 SQL 标识符"""
        pfx, local = shorten(uri_str)
        if pfx and local:
            name = f"{pfx}_{local}"
        else:
            name = uri_str
        name = re.sub(r'[^a-zA-Z0-9_]', '_', name)
        name = re.sub(r'_+', '_', name).strip('_').lower()
        if len(name) > 64:
            name = name[:64]
        if not name or name[0].isdigit():
            name = 't_' + name
        return name

    # 使用 rdflib 解析三元组
    g = Graph()
    g.parse(owl_path, format='xml')

    # 获取所有个体及其类型
    instance_types = defaultdict(set)
    instance_props = defaultdict(lambda: defaultdict(list))

    for s, p, o in g:
        if p == RDF.type and not str(o).startswith(str(RDF)):
            instance_types[s].add(o)
        elif isinstance(s, URIRef) and p != RDF.type:
            instance_props[s][p].append(o)

    # 按类型分组实例
    by_type = defaultdict(set)
    for instance, types in instance_types.items():
        for t in types:
            by_type[t].add(instance)

    # 收集每个类型的所有属性
    type_ref_props = defaultdict(set)
    type_literal_props = defaultdict(set)

    for instance, types in instance_types.items():
        for t in types:
            for prop, values in instance_props[instance].items():
                for v in values:
                    if isinstance(v, URIRef):
                        type_ref_props[t].add(prop)
                    elif isinstance(v, Literal):
                        type_literal_props[t].add(prop)

    # 纯字面值属性（排除同时是引用的属性）
    pure_literal = defaultdict(set)
    for t in set(list(type_ref_props.keys()) + list(type_literal_props.keys())):
        pure_literal[t] = type_literal_props[t] - type_ref_props[t]

    # 生成 SQL
    lines = []
    lines.append(f"-- 从 {owl_path} 生成的 SQL")
    lines.append(f"-- 数据库类型: {db_type}")
    lines.append(f"-- 生成时间: {__import__('datetime').datetime.now().isoformat()}")
    lines.append("")

    # 实例 URI 到自增 ID 的映射（全局自增，同一实体多类型共享 ID）
    uri_to_id = {}
    global_counter = 1

    # 过滤掉元数据类型的表
    typed_tables = []
    for t_uri, instances in sorted(by_type.items(), key=lambda x: -len(x[1])):
        if not instances:
            continue
        type_str = str(t_uri)
        if type_str.startswith(ns_map['owl']) or type_str.startswith(ns_map['rdf']):
            continue
        typed_tables.append((t_uri, instances))

    # 第一遍：为所有实例统一分配 ID（全局自增，避免同一实体多类型时 ID 冲突）
    for t_uri, instances in typed_tables:
        for inst in instances:
            if inst not in uri_to_id:
                uri_to_id[inst] = global_counter
                global_counter += 1

    # 第二遍：生成 DDL 和 INSERT
    for t_uri, instances in typed_tables:
        table_name = to_name(str(t_uri))

        # 列定义
        columns = []
        columns.append("id BIGINT PRIMARY KEY")
        columns.append("uri VARCHAR(512)")

        lit_cols = []
        ref_cols = []

        for prop in sorted(pure_literal[t_uri], key=lambda p: str(p)):
            col_name = to_name(str(prop))
            # 找最大长度
            max_len = 0
            for inst in instances:
                for v in instance_props[inst].get(prop, []):
                    if isinstance(v, Literal):
                        max_len = max(max_len, len(sanitize_value(v)))
            col_type = f"VARCHAR({max(max_len, 32)})" if max_len < 2000 else "TEXT"
            columns.append(f"{col_name} {col_type}")
            lit_cols.append((prop, col_name))

        for prop in sorted(type_ref_props[t_uri], key=lambda p: str(p)):
            col_name = to_name(str(prop))
            columns.append(f"{col_name} BIGINT")
            ref_cols.append((prop, col_name))

        if db_type == 'mysql':
            lines.append(f"DROP TABLE IF EXISTS `{table_name}`;")
            lines.append(f"CREATE TABLE `{table_name}` (")
        else:
            lines.append(f"DROP TABLE IF EXISTS {table_name} CASCADE;")
            lines.append(f"CREATE TABLE {table_name} (")

        for i, col in enumerate(columns):
            comma = ',' if i < len(columns) - 1 else ''
            lines.append(f"    {col}{comma}")
        lines.append(");")
        lines.append("")

        # 生成 INSERT 语句
        for inst in sorted(instances, key=lambda x: str(x)):
            inst_id = uri_to_id[inst]
            values = [str(inst_id), f"'{sanitize_value(str(inst))}'"]

            for prop, col_name in lit_cols:
                vals = instance_props[inst].get(prop, [])
                lit_vals = [sanitize_value(v) for v in vals if isinstance(v, Literal)]
                if lit_vals:
                    values.append(f"'{lit_vals[0]}'")
                else:
                    values.append("NULL")

            for prop, col_name in ref_cols:
                vals = instance_props[inst].get(prop, [])
                ref_vals = [v for v in vals if isinstance(v, URIRef)]
                if ref_vals:
                    ref_id = uri_to_id.get(ref_vals[0], None)
                    if ref_id is not None:
                        values.append(str(ref_id))
                    else:
                        values.append("NULL")
                else:
                    values.append("NULL")

            if db_type == 'mysql':
                lines.append(f"INSERT INTO `{table_name}` VALUES ({', '.join(values)});")
            else:
                lines.append(f"INSERT INTO {table_name} VALUES ({', '.join(values)});")

        lines.append("")

    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description='将 OWL ABox 数据导入关系型数据库')
    parser.add_argument('owl_file', help='OWL 文件路径')
    parser.add_argument('--db', choices=['mysql', 'postgres'], default='mysql',
                        help='目标数据库类型 (默认: mysql)')
    parser.add_argument('--output', '-o', help='输出 SQL 文件路径 (默认: 标准输出)')
    args = parser.parse_args()

    sql = generate_sql(args.owl_file, args.db)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(sql)
        print(f"SQL 已写入: {args.output}")
    else:
        print(sql)


if __name__ == '__main__':
    main()