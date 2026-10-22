export interface TodoVerifyRow {
  section: number;
  category: 'stale_source' | 'null_value' | 'missing_production' | 'agent_sourced' | 'human_verified' | 'assumption' | 'weak_city_mapping';
  path: string;
  table_name: string;
  value: number | null;
  detail: string | null;
  source_url: string | null;
  verified_on: string | null;
  verification: string | null;
  sort_key: number[];
}
export function generateTodoVerify(rows: readonly TodoVerifyRow[]): string;
