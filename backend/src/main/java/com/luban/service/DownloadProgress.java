package com.luban.service;

public record DownloadProgress(String phase, String fileName, int current, int total, int percent) {

    public static DownloadProgress info(String fileName) {
        return new DownloadProgress("DOWNLOADING", fileName, 0, 0, 0);
    }

    public static DownloadProgress downloading(String fileName, int current, int total, int percent) {
        return new DownloadProgress("DOWNLOADING", fileName, current, total, percent);
    }

    public static DownloadProgress registering(String message) {
        return new DownloadProgress("REGISTERING", message, 0, 0, 90);
    }

    public static DownloadProgress done(String fileName) {
        return new DownloadProgress("DOWNLOADING", fileName, 1, 1, 100);
    }
}