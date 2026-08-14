export { z } from 'zod';

// ─── Enums ───
export const IssueType = ['task', 'bug', 'story', 'epic'] as const;
export type IssueType = (typeof IssueType)[number];

export const IssuePriority = ['low', 'medium', 'high', 'critical'] as const;
export type IssuePriority = (typeof IssuePriority)[number];

export const IssueStatus = ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] as const;
export type IssueStatus = (typeof IssueStatus)[number];

export const FocusState = ['deep_flow', 'focused', 'available', 'away', 'in_meeting'] as const;
export type FocusState = (typeof FocusState)[number];

export const TaskPriority = ['P0', 'P1', 'P2', 'P3'] as const;
export type TaskPriority = (typeof TaskPriority)[number];

// ─── API response wrapper ───
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// ─── UUID generator ───
export function uuid(): string {
  return crypto.randomUUID();
}

// ─── ISO timestamp ───
export function nowISO(): string {
  return new Date().toISOString();
}
