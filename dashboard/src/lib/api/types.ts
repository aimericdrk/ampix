// API types per shared contracts §7 (and design spec §14 assumptions).
// Hand-written for phase 1; to be replaced by OpenAPI-generated types with identical names.

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  access_token: string;
  user: AuthUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  timezone: string;
}

export interface ListProjectsResponse {
  projects: Project[];
}
