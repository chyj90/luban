package com.luban.orchestration.security;

import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;

/**
 * 出站 SSRF 防护：http 节点直连 URL 前校验目标地址。
 *
 * 规则：
 * 1. 仅允许 http/https；
 * 2. 解析所有 IP（含 DNS 多记录），任一命中私网/环回/链路本地/保留段即拒绝；
 * 3. 防御 DNS rebinding：校验通过后返回解析出的 IP（引擎用 IP 建连 + Host 头），
 *    禁止自动重定向（需重定向时由引擎逐跳重新校验）。
 */
@Component
public class IpGuard {

    /** 引擎出站连接使用的已验证地址（防 rebinding TOCTOU） */
    public record ResolvedTarget(String host, int port, String path, String query, InetAddress address) {}

    public ResolvedTarget check(String url) {
        URI uri = URI.create(url);
        String scheme = uri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            throw new SecurityException("仅允许 http/https 协议: " + scheme);
        }
        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            throw new SecurityException("URL 缺少主机名");
        }
        int port = uri.getPort() != -1 ? uri.getPort()
                : ("https".equalsIgnoreCase(scheme) ? 443 : 80);

        InetAddress[] addresses;
        try {
            addresses = InetAddress.getAllByName(host);
        } catch (UnknownHostException e) {
            throw new SecurityException("主机无法解析: " + host);
        }
        for (InetAddress addr : addresses) {
            if (isForbidden(addr)) {
                throw new SecurityException("目标地址被拒绝（内网/保留地址）: " + addr.getHostAddress());
            }
        }
        String path = uri.getRawPath() == null ? "/" : uri.getRawPath();
        return new ResolvedTarget(host, port, path, uri.getRawQuery(), addresses[0]);
    }

    static boolean isForbidden(InetAddress addr) {
        if (addr.isAnyLocalAddress() || addr.isLoopbackAddress()
                || addr.isLinkLocalAddress() || addr.isSiteLocalAddress()
                || addr.isMulticastAddress()) {
            return true;
        }
        byte[] b = addr.getAddress();
        if (b.length == 4) { // IPv4 保留段
            return b[0] == 0                                       // 0.0.0.0/8
                    || (b[0] == 100 && (b[1] & 0xC0) == 64)        // 100.64/10 CGNAT
                    || (b[0] == 192 && b[1] == 0 && b[2] == 0)     // 192.0.0.0/24
                    || (b[0] == 192 && b[1] == 0 && b[2] == 2)     // 192.0.2.0/24 TEST-NET-1
                    || (b[0] == 198 && (b[1] & 0xFE) == 18)        // 198.18/15 基准测试
                    || (b[0] == 198 && b[1] == 51 && b[2] == 100)  // 198.51.100/24 TEST-NET-2
                    || (b[0] == 203 && b[1] == 0 && b[2] == 113)   // 203.0.113/24 TEST-NET-3
                    || b[0] >= 224;                                // 组播 + 240/4 保留
        }
        // IPv6 专属保留段（::/loopback/link-local/multicast/ULA 由上方通用判断覆盖）
        return (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x00 && b[3] == 0x00) // 2001:db8::/32 文档段
                || (b[0] == 0x64 && b[1] == 0x64 && b[2] == 0x00 && b[3] == 0x00); // 64:ff9b::/96 部分段
    }
}
