package com.luban.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * 请求体缓存过滤器：把 JSON 请求体读入内存并以属性形式暴露，
 * 供 AppAccessInterceptor 在 preHandle 阶段解析 body 中的 applicationId / 资源 id。
 * 平台请求体均为小体积 JSON，缓存安全；非 JSON 体不缓存。
 */
@Component
public class CachedBodyFilter extends OncePerRequestFilter {

    public static final String CACHED_BODY_ATTR = "cached_body";
    private static final int MAX_CACHED_BYTES = 512 * 1024;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String contentType = request.getContentType();
        boolean json = contentType != null && contentType.contains(MediaType_JSON);
        long contentLength = request.getContentLengthLong();
        if (!json || contentLength > MAX_CACHED_BYTES) {
            filterChain.doFilter(request, response);
            return;
        }
        CachedBodyRequestWrapper wrapper = new CachedBodyRequestWrapper(request);
        request.setAttribute(CACHED_BODY_ATTR, wrapper.getCachedBody());
        filterChain.doFilter(wrapper, response);
    }

    private static final String MediaType_JSON = "application/json";

    static class CachedBodyRequestWrapper extends HttpServletRequestWrapper {
        private final byte[] cached;

        CachedBodyRequestWrapper(HttpServletRequest request) throws IOException {
            super(request);
            ServletInputStream in = request.getInputStream();
            this.cached = in.readAllBytes();
        }

        String getCachedBody() {
            return new String(cached, StandardCharsets.UTF_8);
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream buffer = new ByteArrayInputStream(cached);
            return new ServletInputStream() {
                @Override public int read() { return buffer.read(); }
                @Override public boolean isFinished() { return buffer.available() == 0; }
                @Override public boolean isReady() { return true; }
                @Override public void setReadListener(ReadListener listener) { /* 同步流不需要 */ }
            };
        }
    }
}
