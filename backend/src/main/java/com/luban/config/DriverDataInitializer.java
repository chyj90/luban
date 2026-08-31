package com.luban.config;

import com.luban.entity.JdbcDriver;
import com.luban.repository.JdbcDriverRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class DriverDataInitializer implements CommandLineRunner {

    private final JdbcDriverRepository driverRepository;

    @Override
    public void run(String... args) {
        initPresetDrivers();
    }

    private static String ef(String... fields) {
        if (fields == null || fields.length == 0) return null;
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < fields.length; i += 5) {
            if (i > 0) sb.append(",");
            sb.append("{\"name\":\"").append(fields[i])
              .append("\",\"label\":\"").append(fields[i + 1])
              .append("\",\"placeholder\":\"").append(fields[i + 2])
              .append("\",\"type\":\"").append(fields[i + 3])
              .append("\",\"required\":").append(fields[i + 4])
              .append("}");
        }
        return sb.append("]").toString();
    }

    private void initPresetDrivers() {
        List<JdbcDriver> presets = List.of(
                createDriver("clickhouse", "ClickHouse", "列式 OLAP 数据库", "OLAP",
                        "com.clickhouse.jdbc.ClickHouseDriver",
                        "jdbc:clickhouse://{host}:{port}/{database}",
                        8123, "com.clickhouse", "clickhouse-jdbc", "0.7.0", null, false,
                        null, false),
                createDriver("starrocks", "StarRocks", "实时分析 MPP 数据库", "OLAP",
                        "com.mysql.cj.jdbc.Driver",
                        "jdbc:mysql://{host}:{port}/{database}?useSSL=false",
                        9030, "com.mysql", "mysql-connector-j", "8.0.33", null, true,
                        null, false),
                createDriver("doris", "Apache Doris", "高性能实时分析数据库", "OLAP",
                        "com.mysql.cj.jdbc.Driver",
                        "jdbc:mysql://{host}:{port}/{database}?useSSL=false",
                        9030, "com.mysql", "mysql-connector-j", "8.0.33", null, true,
                        null, false),
                createDriver("druid", "Apache Druid", "实时分析数据库", "OLAP",
                        "org.apache.calcite.avatica.remote.Driver",
                        "jdbc:avatica:remote:url=http://{host}:{port}/druid/v2/sql/avatica/",
                        8888, "org.apache.calcite.avatica", "avatica-core", "1.23.0", null, false,
                        null, false),
                createDriver("kylin", "Apache Kylin", "OLAP 分析引擎", "OLAP",
                        "org.apache.kylin.jdbc.Driver",
                        "jdbc:kylin://{host}:{port}/{database}",
                        7070, "org.apache.kylin", "kylin-jdbc", "4.0.3", null, false,
                        ef("project", "项目名称", "learn_kylin", "text", "true"), false),
                createDriver("presto", "PrestoDB", "分布式 SQL 查询引擎", "QUERY_ENGINE",
                        "com.facebook.presto.jdbc.PrestoDriver",
                        "jdbc:presto://{host}:{port}/{catalog}/{schema}",
                        8080, "com.facebook.presto", "presto-jdbc", "0.283", null, false,
                        ef("catalog", "Catalog", "hive", "text", "true",
                           "schema", "Schema", "default", "text", "true"), true),
                createDriver("trino", "Trino", "分布式 SQL 查询引擎（Presto 继任者）", "QUERY_ENGINE",
                        "io.trino.jdbc.TrinoDriver",
                        "jdbc:trino://{host}:{port}/{catalog}/{schema}",
                        8080, "io.trino", "trino-jdbc", "462", null, false,
                        ef("catalog", "Catalog", "tpch", "text", "true",
                           "schema", "Schema", "default", "text", "true"), true),
                createDriver("hive", "Apache Hive", "数据仓库 SQL 分析", "DATALAKE",
                        "org.apache.hive.jdbc.HiveDriver",
                        "jdbc:hive2://{host}:{port}/{database}",
                        10000, "org.apache.hive", "hive-jdbc", "3.1.3", "standalone", false,
                        ef("principal", "Kerberos Principal", "hive/_HOST@REALM", "text", "false",
                           "transportMode", "传输模式", "http", "select", "false"), false),
                createDriver("spark", "Apache Spark SQL", "大规模数据处理引擎", "DATALAKE",
                        "org.apache.hive.jdbc.HiveDriver",
                        "jdbc:hive2://{host}:{port}/{database}",
                        10016, "org.apache.hive", "hive-jdbc", "3.1.3", null, true,
                        ef("principal", "Kerberos Principal", "hive/_HOST@REALM", "text", "false",
                           "transportMode", "传输模式", "http", "select", "false"), false),
                createDriver("flink", "Apache Flink SQL", "流批一体计算引擎", "DATALAKE",
                        "org.apache.flink.table.jdbc.FlinkDriver",
                        "jdbc:flink://{host}:{port}/{database}",
                        8083, "org.apache.flink", "flink-table-api-java-bridge", "1.18.0",
                        null, false, null, false),
                createDriver("oracle", "Oracle", "关系型数据库", "RELATIONAL",
                        "oracle.jdbc.OracleDriver",
                        "jdbc:oracle:thin:@//{host}:{port}/{database}",
                        1521, "com.oracle.database.jdbc", "ojdbc8", "21.9.0.0", null, false,
                        ef("serviceName", "Service Name", "ORCL", "text", "false"), false),
                createDriver("sqlserver", "SQL Server", "微软关系型数据库", "RELATIONAL",
                        "com.microsoft.sqlserver.jdbc.SQLServerDriver",
                        "jdbc:sqlserver://{host}:{port};databaseName={database}",
                        1433, "com.microsoft.sqlserver", "mssql-jdbc", "12.4.2.jre11", null, false,
                        ef("instance", "实例名", "", "text", "false"), false),
                createDriver("redshift", "Amazon Redshift", "云数据仓库", "CLOUD",
                        "com.amazon.redshift.jdbc.Driver",
                        "jdbc:redshift://{host}:{port}/{database}",
                        5439, "com.amazon.redshift", "redshift-jdbc42", "2.1.0.16", null, false,
                        null, false),
                createDriver("snowflake", "Snowflake", "云数据平台", "CLOUD",
                        "net.snowflake.client.jdbc.SnowflakeDriver",
                        "jdbc:snowflake://{host}:{port}/?db={database}&schema={schema}&warehouse={warehouse}",
                        443, "net.snowflake", "snowflake-jdbc", "3.14.4", null, false,
                        ef("schema", "Schema", "PUBLIC", "text", "true",
                           "warehouse", "Warehouse", "COMPUTE_WH", "text", "true",
                           "account", "Account", "xy12345.us-east-1", "text", "true"), false)
        );

        for (JdbcDriver preset : presets) {
            var existing = driverRepository.findByName(preset.getName());
            if (existing.isEmpty()) {
                driverRepository.save(preset);
                log.info("预置驱动: {} ({})", preset.getDisplayName(), preset.getName());
            } else if (!preset.getVersion().equals(existing.get().getVersion())) {
                JdbcDriver db = existing.get();
                db.setVersion(preset.getVersion());
                db.setGroupId(preset.getGroupId());
                db.setArtifactId(preset.getArtifactId());
                db.setClassifier(preset.getClassifier());
                db.setInstalled(false);
                driverRepository.save(db);
                log.info("驱动版本更新: {} {} -> {}", preset.getName(), existing.get().getVersion(), preset.getVersion());
            }
        }
    }

    private JdbcDriver createDriver(String name, String displayName, String description,
                                    String category, String driverClass, String jdbcUrlTemplate,
                                    int defaultPort, String groupId, String artifactId,
                                    String version, String classifier, boolean builtin,
                                    String extraFields, boolean hideStandardFields) {
        JdbcDriver d = new JdbcDriver();
        d.setName(name);
        d.setDisplayName(displayName);
        d.setDescription(description);
        d.setCategory(category);
        d.setDriverClass(driverClass);
        d.setJdbcUrlTemplate(jdbcUrlTemplate);
        d.setDefaultPort(defaultPort);
        d.setGroupId(groupId);
        d.setArtifactId(artifactId);
        d.setVersion(version);
        d.setClassifier(classifier);
        d.setInstalled(false);
        d.setBuiltin(builtin);
        d.setEnabled(true);
        d.setExtraFields(extraFields);
        d.setHideStandardFields(hideStandardFields);
        return d;
    }
}