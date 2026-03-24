// 类型定义已从 mockData.ts 移除，使用内联类型定义

const API_BASE_URL = '/api/v1';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// 通用请求函数
async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data: ApiResponse<T> = await response.json();
    return data.data;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
}

// 仪表盘相关
export async function getDashboardStats() {
  return request<{
    total_screenings: number;
    monthly_screenings: number;
    pending_alerts: number;
    completion_rate: number;
    alert_distribution: {
      green: number;
      yellow: number;
      orange: number;
      red: number;
    };
    trend_data: Array<{
      date: string;
      count: number;
      alerts: number;
    }>;
  }>('/dashboard/stats');
}

export async function getRecentAlerts(limit: number = 5) {
  return request<Array<{
    id: number;
    alert_id: string;
    name: string;
    level: string;
    trigger: string;
    status: string;
    created_at: string;
    assignee_name: string | null;
  }>>(`/dashboard/recent-alerts?limit=${limit}`);
}

// 筛查相关
export async function getScreeningList() {
  return request<Array<{
    id: number;
    name: string;
    age: number;
    gender: string;
    score: number;
    max_score: number;
    alert_level: string;
    status: string;
    created_at: string;
    questionnaire_name: string;
    counselor_name: string;
  }>>('/screening');
}

export async function getScreeningDetail(id: number) {
  return request<{
    id: number;
    name: string;
    age: number;
    gender: string;
    score: number;
    max_score: number;
    alert_level: string;
    status: string;
    created_at: string;
    questionnaire_name: string;
    counselor_name: string;
    questions: string | null;
    answers: string | null;
  }>(`/screening/${id}`);
}

// 预警相关
export async function getAlertList() {
  return request<Array<{
    id: number;
    alert_id: string;
    name: string;
    level: string;
    trigger: string;
    status: string;
    assignee_name: string | null;
    created_at: string;
  }>>('/alerts');
}

// 案例相关
export async function getCaseList() {
  return request<Array<{
    id: number;
    case_id: string;
    name: string;
    age: number;
    gender: string;
    department: string;
    tags: string[];
    screening_count: number;
    last_screening: string;
    alert_level: string;
    status: string;
  }>>('/cases');
}

// 检索相关
export async function searchSimilarCases(query: string, modality: string, top_k: number = 5) {
  return request<{
    query: string;
    results: Array<{
      id: string;
      summary: string;
      tags: string[];
      similarity: number;
    }>;
    total: number;
  }>('/retrieval/search', {
    method: 'POST',
    body: JSON.stringify({ query, modality, top_k }),
  });
}

export async function analyzeScreening(screening_id: number, include_retrieval: boolean = true, top_k: number = 5) {
  return request<{
    screening_id: number;
    retrieval_results: any;
    rag_report: any;
  }>('/retrieval/analyze', {
    method: 'POST',
    body: JSON.stringify({ screening_id, include_retrieval, top_k }),
  });
}