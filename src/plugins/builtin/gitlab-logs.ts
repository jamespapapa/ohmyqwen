import { RuntimePlugin } from "../types.js";

interface GitlabPipeline {
  id: number;
  status: string;
  ref?: string;
  web_url?: string;
}

interface GitlabJob {
  id: number;
  name: string;
  status: string;
  stage?: string;
}

function getGitlabConfig() {
  const baseUrl =
    process.env.OHMYQWEN_GITLAB_BASE_URL?.trim() || process.env.GITLAB_BASE_URL?.trim() || "";
  const projectId =
    process.env.OHMYQWEN_GITLAB_PROJECT_ID?.trim() || process.env.GITLAB_PROJECT_ID?.trim() || "";
  const token =
    process.env.OHMYQWEN_GITLAB_TOKEN?.trim() ||
    process.env.GITLAB_TOKEN?.trim() ||
    process.env.GITLAB_PRIVATE_TOKEN?.trim() ||
    "";

  return {
    baseUrl,
    projectId,
    token
  };
}

async function gitlabGet<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "PRIVATE-TOKEN": token
    }
  });

  if (!response.ok) {
    throw new Error(`GitLab API ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

export function createGitlabLogsPlugin(): RuntimePlugin {
  return {
    name: "gitlab-logs",
    async beforeImplement() {
      const config = getGitlabConfig();
      if (!config.baseUrl || !config.projectId || !config.token) {
        return {
          summary: "gitlab logs plugin disabled",
          warnings: [
            "GitLab env is missing (OHMYQWEN_GITLAB_BASE_URL / PROJECT_ID / TOKEN); plugin skipped"
          ]
        };
      }

      try {
        const base = config.baseUrl.replace(/\/+$/, "");
        const pipelines = await gitlabGet<GitlabPipeline[]>(
          `${base}/api/v4/projects/${encodeURIComponent(config.projectId)}/pipelines?per_page=3`,
          config.token
        );

        const lines: string[] = [];
        for (const pipeline of pipelines.slice(0, 3)) {
          lines.push(
            `pipeline#${pipeline.id} status=${pipeline.status} ref=${pipeline.ref ?? "unknown"} url=${pipeline.web_url ?? "n/a"}`
          );

          try {
            const jobs = await gitlabGet<GitlabJob[]>(
              `${base}/api/v4/projects/${encodeURIComponent(config.projectId)}/pipelines/${pipeline.id}/jobs?per_page=5`,
              config.token
            );
            for (const job of jobs.slice(0, 5)) {
              lines.push(
                `job#${job.id} ${job.stage ?? "stage"}/${job.name} status=${job.status}`
              );
            }
          } catch (error) {
            lines.push(
              `pipeline#${pipeline.id} jobs unavailable: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        return {
          summary: `collected ${lines.length} gitlab context lines`,
          context: lines,
          metadata: {
            pipelines: pipelines.length
          }
        };
      } catch (error) {
        return {
          summary: "gitlab logs unavailable",
          warnings: [error instanceof Error ? error.message : String(error)]
        };
      }
    }
  };
}
