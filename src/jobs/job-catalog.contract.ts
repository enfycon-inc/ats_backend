export interface JobCatalogQuery {
  page?: string | number; limit?: string | number; filter?: string; search?: string;
  status?: string; priority?: string; tab?: string; predefined?: string;
  client?: string; branch?: string; unit?: string; creator?: string; recruiter?: string; pod?: string;
  from?: string; to?: string; sort?: string; direction?: string;
}
export interface JobCatalogResponse<Row> {
  data: Row[]; total: number; page: number; limit: number; totalPages: number;
  options?: Record<string, string[]>;
}
