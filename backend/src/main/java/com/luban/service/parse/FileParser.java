package com.luban.service.parse;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;

/**
 * 文件解析器 SPI。实现必须无状态、可单测（输入流进、产物出）。
 */
public interface FileParser {

    /** 是否支持该扩展名（小写，不含点） */
    boolean supports(String ext);

    /**
     * 解析文件。解析失败抛 IOException/IllegalArgumentException，
     * 上传方会拒收并删除已存文件，不落半成品。
     */
    ParsedFile parse(InputStream in, long size) throws IOException;
}
