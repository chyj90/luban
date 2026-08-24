import { useState } from 'react';
import './ConceptTracePanel.css';

interface ConceptTrace {
  type?: string;
  conceptId?: number;
  conceptName?: string;
  message?: string;
  confidence?: number;
  depth?: number;
  domain?: string;
  conceptCount?: number;
  sampleConcepts?: string;
  concepts?: { conceptId: number; conceptName: string; confidence?: number; depth?: number }[];
  pipeline?: {
    faiss?: {
      matched: boolean;
      concepts?: { conceptId: number; conceptName: string; confidence?: number }[];
    };
    ontology?: {
      expanded: boolean;
      concepts?: { conceptId: number; conceptName: string; depth?: number; confidence?: number }[];
      relations?: { [key: string]: { conceptId: number; conceptName: string; relation: string; confidence?: number }[] };
    };
    submitted?: {
      conceptCount?: number;
      concepts?: { conceptId: number; conceptName: string; depth?: number }[];
      toolCount?: number;
      tableMappingCount?: number;
      joinMappingCount?: number;
      tools?: { name: string; description?: string }[];
      tableMappings?: { mappingType: string; tableName: string; columnName: string }[];
      joinMappings?: { joinType: string; joinTable: string; joinCondition?: string }[];
    };
  };
}

interface ConceptTracePanelProps {
  traces: ConceptTrace[];
  collapsed?: boolean;
  usedConcepts?: { conceptId: number; conceptName: string }[];
}

export default function ConceptTracePanel({ traces, collapsed: initialCollapsed = true, usedConcepts: usedConceptsProp }: ConceptTracePanelProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  if (!traces || traces.length === 0) return null;

  const pipelineTrace = traces.find(t => t.type === 'pipeline');
  const pipeline = pipelineTrace?.pipeline;
  const hasPipeline = !!pipelineTrace;

  // 优先从 traces 中查找 used_concepts，其次使用 prop
  const usedTrace = traces.find(t => t.type === 'used_concepts');
  const usedConcepts: { conceptId: number; conceptName: string }[] = usedTrace?.concepts || usedConceptsProp || [];

  // 本体扩展阶段编号：根据 FAISS 是否命中决定
  const ontologyStageNum = pipeline?.faiss?.matched ? 2 : 1;
  const submittedStageNum = pipeline?.faiss?.matched ? 3 : 2;

  return (
    <div className="conceptTracePanel">
      <div className="traceHeader" onClick={() => setCollapsed(!collapsed)}>
        <span className="traceIcon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {hasPipeline ? (
              <>
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </>
            ) : (
              <>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </>
            )}
          </svg>
        </span>
        <span className="traceTitle">概念追踪管道</span>
        <span className="traceArrow">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="traceBody">
          {hasPipeline && pipeline && (
            <div className="pipelineStages">
              {/* 1. FAISS */}
              {pipeline.faiss?.matched && (
                <div className="pipelineStage">
                  <div className="pipelineStageHeader">
                    <span className="pipelineStageDot faiss" />
                    <span className="pipelineStageLabel">1. FAISS 语义搜索</span>
                    <span className="pipelineStageStatus hit">命中</span>
                  </div>
                  {pipeline.faiss.concepts && pipeline.faiss.concepts.length > 0 && (
                    <div className="pipelineStageConcepts">
                      {pipeline.faiss.concepts.map((c, i) => (
                        <span key={i} className="pipelineConceptTag">
                          {c.conceptName}
                          {c.confidence !== undefined && (
                            <span className="pipelineConfidence">{(c.confidence * 100).toFixed(0)}%</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!pipeline.faiss?.matched && (
                <div className="pipelineStage">
                  <div className="pipelineStageHeader">
                    <span className="pipelineStageDot faiss" />
                    <span className="pipelineStageLabel">1. FAISS 语义搜索</span>
                    <span className="pipelineStageStatus miss">未命中</span>
                  </div>
                  <div className="pipelineStageEmpty">未匹配到任何概念，将提交全部概念给 LLM 判断</div>
                </div>
              )}

              {/* 2. 本体关系扩展 - 始终显示 */}
              <div className="pipelineStage">
                <div className="pipelineStageHeader">
                  <span className="pipelineStageDot ontology" />
                  <span className="pipelineStageLabel">{ontologyStageNum}. 本体关系扩展</span>
                  {pipeline.ontology?.expanded && pipeline.ontology.concepts && pipeline.ontology.concepts.length > 0 ? (
                    <span className="pipelineStageStatus hit">关联 {pipeline.ontology.concepts.length} 个</span>
                  ) : pipeline.ontology?.relations && Object.keys(pipeline.ontology.relations).length > 0 ? (
                    <span className="pipelineStageStatus hit">关联 {Object.keys(pipeline.ontology.relations).length} 组</span>
                  ) : (
                    <span className="pipelineStageStatus miss">未扩展</span>
                  )}
                </div>
                {pipeline.ontology?.expanded && pipeline.ontology.concepts && pipeline.ontology.concepts.length > 0 && (
                  <div className="pipelineStageConcepts">
                    {pipeline.ontology.concepts.map((c, i) => (
                      <span key={i} className="pipelineConceptTag related">
                        {c.conceptName}
                        {c.depth !== undefined && (
                          <span className="pipelineDepth">深度 {c.depth}</span>
                        )}
                        {c.confidence !== undefined && (
                          <span className="pipelineConfidence">{(c.confidence * 100).toFixed(0)}%</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {(!pipeline.ontology?.expanded || (!pipeline.ontology?.concepts || pipeline.ontology.concepts.length === 0) && (!pipeline.ontology?.relations || Object.keys(pipeline.ontology.relations).length === 0)) && (
                  <div className="pipelineStageEmpty">本体未找到关联概念，可能是多轮对话复用或未配置本体关系</div>
                )}
              </div>

              {/* 3. 提交给 LLM */}
              <div className="pipelineStage">
                <div className="pipelineStageHeader">
                  <span className="pipelineStageDot submitted" />
                  <span className="pipelineStageLabel">{submittedStageNum}. 提交给 LLM 的上下文</span>
                </div>
                <div className="pipelineSubmitted">
                  <div className="pipelineSubmittedRow">
                    <span className="pipelineSubmittedLabel">概念</span>
                    <span className="pipelineSubmittedValue">{pipeline.submitted?.conceptCount ?? 0} 个</span>
                  </div>
                  {pipeline.submitted?.concepts && pipeline.submitted.concepts.length > 0 && (
                    <div className="pipelineStageConcepts">
                      {pipeline.submitted.concepts.map((c, i) => (
                        <span key={i} className="pipelineConceptTag submitted">
                          {c.conceptName}
                          {c.depth !== undefined && c.depth > 0 && (
                            <span className="pipelineDepth">深度 {c.depth}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="pipelineSubmittedRow">
                    <span className="pipelineSubmittedLabel">工具</span>
                    <span className="pipelineSubmittedValue">{pipeline.submitted?.toolCount ?? 0} 个</span>
                  </div>
                  {pipeline.submitted?.tools && pipeline.submitted.tools.length > 0 && (
                    <div className="pipelineSubmittedDetail">
                      {pipeline.submitted.tools.map((t, i) => (
                        <div key={i} className="pipelineSubmittedItem" title={t.description}>
                          <code>{t.name}</code>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="pipelineSubmittedRow">
                    <span className="pipelineSubmittedLabel">表映射</span>
                    <span className="pipelineSubmittedValue">{pipeline.submitted?.tableMappingCount ?? 0} 个</span>
                  </div>
                  {pipeline.submitted?.tableMappings && pipeline.submitted.tableMappings.length > 0 && (
                    <div className="pipelineSubmittedDetail">
                      {pipeline.submitted.tableMappings.map((m, i) => (
                        <div key={i} className="pipelineSubmittedItem">
                          <span className="pipelineMappingType">{m.mappingType}</span>
                          <code>{m.tableName}.{m.columnName}</code>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="pipelineSubmittedRow">
                    <span className="pipelineSubmittedLabel">JOIN 关联</span>
                    <span className="pipelineSubmittedValue">{pipeline.submitted?.joinMappingCount ?? 0} 个</span>
                  </div>
                  {pipeline.submitted?.joinMappings && pipeline.submitted.joinMappings.length > 0 && (
                    <div className="pipelineSubmittedDetail">
                      {pipeline.submitted.joinMappings.map((j, i) => (
                        <div key={i} className="pipelineSubmittedItem">
                          <span className="pipelineJoinType">{j.joinType}</span>
                          <code>{j.joinTable}</code>
                          {j.joinCondition && <span className="pipelineJoinCond">{j.joinCondition}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 4. LLM 识别概念 */}
              {usedConcepts.length > 0 && (
                <div className="pipelineStage">
                  <div className="pipelineStageHeader">
                    <span className="pipelineStageDot used" />
                    <span className="pipelineStageLabel">{submittedStageNum + 1}. LLM 识别概念</span>
                    <span className="pipelineStageStatus hit">{usedConcepts.length} 个</span>
                  </div>
                  <div className="pipelineStageConcepts">
                    {usedConcepts.map((c, i) => (
                      <span key={i} className="pipelineConceptTag used">
                        {c.conceptName}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}