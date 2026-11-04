export interface JobCatalogQuery {
  delivery?: string; period?: string; cities?: string; deliveryFrom?: string; deliveryTo?: string; jobType?: string;
  page?: string | number; limit?: string | number; filter?: string; search?: string;
  status?: string; priority?: string; tab?: string; predefined?: string;
  client?: string; branch?: string; unit?: string; creator?: string; recruiter?: string; pod?: string;
  from?: string; to?: string; sort?: string; direction?: string;
  accountManagers?: string; recruiters?: string; workMode?: string; conditions?: string;
  branches?: string; clients?: string; workModes?: string; statuses?: string; priorities?: string;
}
export interface JobCatalogResponse<Row> {
  data: Row[]; total: number; page: number; limit: number; totalPages: number;
  options?: Record<string, string[] | JobCatalogPersonOption[]>;
}

export interface JobCatalogPersonOption {
  id: string;
  label: string;
}
