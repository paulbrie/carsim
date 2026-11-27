export const EXAM_LIMITS: { laps: number; waiting: number; timeoutMs: number; perHour: number; hourMs: number; heapMb: number; outMax: number };
export class ExamError extends Error { status: number; constructor(status: number, message: string) }
export interface ExamJob { course: unknown; ground: string; car: string; network: unknown }
/** time: the best lap through every gate (null: none); why it ended: 'laps' | 'wrecked' | 'stuck' | 'slow' */
export interface ExamResult { time: number | null; laps: { time: number; valid: boolean }[]; why: string; seconds: number }
export interface ExamAnswer { ok: true; exam: ExamResult; file: Record<string, unknown>; course: { key: string; length: number }; car: string; ground: string; build: string }
export function runExam(job: ExamJob, opts?: { root?: string; timeoutMs?: number }): Promise<ExamAnswer>;
export class Exams {
  constructor(opts?: { run?: (job: ExamJob) => Promise<ExamAnswer>; now?: () => number });
  submit(who: string, job: ExamJob): Promise<ExamAnswer>;
}
export function exams(): Exams;
