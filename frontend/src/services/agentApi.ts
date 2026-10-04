import { request } from './http';

export interface GraphNode {
  entity_key: string;
  entity_type: string;
  name: string;
  description?: string;
}

export interface GraphPath {
  path_id: string;
  nodes: GraphNode[];
  relations: { subject_key: string; predicate: string; object_key: string }[];
  reason: string;
}

export interface RuleDecision {
  rule_key: string;
  rule_name: string;
  priority: number;
  requires_human_review: boolean;
  recommended_actions: string[];
  message: string;
}

export interface ProposedTask {
  task_key: string;
  title: string;
  due_at: string;
  status: 'proposed' | 'confirmed' | 'modified' | 'rejected';
  requires_confirmation: boolean;
}

export interface EvidencePack {
  subject_ref?: string;
  screening: {
    questionnaire?: string;
    score?: number;
    max_score?: number;
    alert_level?: string;
    date?: string;
    consent_status?: string;
  };
  trend?: {
    sample_count?: number;
    score_delta_from_previous?: number | null;
  };
  controls?: {
    requires_human_review?: boolean;
    external_llm_allowed?: boolean;
    diagnosis_allowed?: boolean;
  };
}

export interface WarningAssessment {
  agent_name: string;
  agent_version: string;
  generated_at: string;
  subject_ref?: string;
  assessment_status: string;
  diagnosis_allowed: boolean;
  automatic_intervention_allowed: boolean;
  requires_human_review: boolean;
  evidence_summary: string[];
  knowledge_path_count: number;
  rule_decisions: RuleDecision[];
  proposed_tasks: ProposedTask[];
  operator_actions: string[];
  notice: string;
}

export interface AssessmentResponse {
  assessment: WarningAssessment;
  evidence_pack: EvidencePack;
  knowledge_graph: {
    paths: GraphPath[];
    rule_decisions: RuleDecision[];
  };
}

export interface GraphOverview {
  entity_count: number;
  relation_count: number;
  active_rule_count: number;
  scope: string;
}

export function getGraphOverview() {
  return request.get<GraphOverview>('/api/knowledge-graph/overview');
}

export function assessWarning(screeningId: number) {
  return request.post<AssessmentResponse>('/api/agents/warning-assessment', {
    screening_id: screeningId,
  });
}
