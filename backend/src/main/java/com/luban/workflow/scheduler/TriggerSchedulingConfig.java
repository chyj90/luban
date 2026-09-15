package com.luban.workflow.scheduler;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** 开启 @Scheduled 调度（此前流程超时扫描 DeadlineScheduler 未生效的根因之一）。 */
@Configuration
@EnableScheduling
public class TriggerSchedulingConfig {
}
