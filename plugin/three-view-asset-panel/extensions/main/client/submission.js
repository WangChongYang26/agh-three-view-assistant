import { prepareProjectImages } from './storage.js'

export function assertSubmissionIdentity(session, sessionId, project, currentProject) {
  if (session.sessionId !== sessionId) throw new Error('会话已切换，请重新提交')
  if (currentProject() !== project) throw new Error('项目已切换或修改，请重新提交')
}

/** Every asynchronous preparation step remains bound to the clicked session/project. */
export async function prepareSubmission(session, sessionId, project, action, { currentProject, waitForSave, persist, prepareImages = prepareProjectImages }) {
  const assertCurrent = expected => assertSubmissionIdentity(session, sessionId, expected, currentProject)
  assertCurrent(project)
  await waitForSave()
  assertCurrent(project)
  if (action === 'inspect') return project
  const prepared = await prepareImages(project)
  assertCurrent(project)
  await persist(prepared)
  assertCurrent(prepared)
  return prepared
}
