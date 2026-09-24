import type { Project, ProjectPsd } from '@/types'

let idSeq = 0
export function genId(prefix: string): string {
  return `${prefix}${Date.now()}${(idSeq++).toString(36)}`
}

export async function loadProjectsData(): Promise<Project[]> {
  const data = (await window.api.loadProjects()) as { projects?: Project[] }
  const projects = data?.projects ?? []
  // 兼容旧数据补全字段
  for (const p of projects) {
    p.groups ||= []
    for (const psd of p.psds) psd.groupId ??= null
  }
  return projects
}

export function saveProjectsData(projects: Project[]): void {
  void window.api.saveProjects({ projects })
}

export function createProject(name: string): Project {
  return { id: genId('p'), name, createdAt: Date.now(), groups: [], psds: [] }
}

export function makePsdItem(name: string, path: string, w: number, h: number): ProjectPsd {
  return { id: genId('s'), name, path, w, h, groupId: null }
}

export function psdDisplayName(psd: ProjectPsd): string {
  return psd.name || psd.path.replace(/[\\/]/g, '/').split('/').pop() || psd.path
}
