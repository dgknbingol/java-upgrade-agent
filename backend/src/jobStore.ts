import { Job } from './types';

const jobs = new Map<string, Job>();

export function createJob(job: Job): void {
  jobs.set(job.id, job);
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function getAllJobs(): Job[] {
  return Array.from(jobs.values());
}
