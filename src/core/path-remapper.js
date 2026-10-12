export class PathRemapper {
  static ROOT_PLACEHOLDER = '${PROJECT_ROOT}';

  /**
   * 将文本中的所有原绝对路径（兼容各种斜杠组合与转义）替换为占位符
   */
  static toCanonical(text, projectRoot) {
    if (!text || !projectRoot) return text;

    const rootSlash = projectRoot.replace(/[\\/]+/g, '/').replace(/\/$/, '');
    const rootBackslash = projectRoot.replace(/[\\/]+/g, '\\').replace(/\\$/, '');

    // 匹配正斜杠版本
    const escapedSlash = rootSlash.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&');
    // 匹配双反斜杠版本 (JSON 转义)
    const escapedDoubleBack = rootBackslash.replace(/\\/g, '\\\\').replace(/[.*+?^$\{}()|[\]]/g, '\\$&');
    // 匹配单反斜杠版本
    const escapedBack = rootBackslash.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&');

    const combinedRegex = new RegExp(`(${escapedDoubleBack}|${escapedSlash}|${escapedBack})`, 'gi');

    return text.replace(combinedRegex, this.ROOT_PLACEHOLDER);
  }

  /**
   * 将占位符还原为目标机器的本地路径
   */
  static toLocal(text, targetProjectRoot) {
    if (!text || !targetProjectRoot) return text;

    const normalizedTarget = targetProjectRoot.replace(/[\\/]+/g, '/').replace(/\/$/, '');
    const placeholderRegex = /\$\{PROJECT_ROOT\}/g;

    return text.replace(placeholderRegex, normalizedTarget);
  }

  /**
   * 对整个会话中的所有事件（用户输入、AI答复、工具参数、工具输出结果）进行完整路径 Rebase
   */
  static rebaseSession(canonicalSession, targetProjectRoot) {
    if (!canonicalSession || !targetProjectRoot) return canonicalSession;

    const sourceRoot = canonicalSession.project?.originalCwd || '';
    const rebased = JSON.parse(JSON.stringify(canonicalSession));
    rebased.project.originalCwd = targetProjectRoot;

    const events = rebased.events || rebased.messages || [];
    for (const ev of events) {
      if (ev.content && typeof ev.content === 'string') {
        const canonicalContent = sourceRoot ? this.toCanonical(ev.content, sourceRoot) : ev.content;
        ev.content = this.toLocal(canonicalContent, targetProjectRoot);
      }
      if (ev.arguments && typeof ev.arguments === 'string') {
        const canonicalArgs = sourceRoot ? this.toCanonical(ev.arguments, sourceRoot) : ev.arguments;
        ev.arguments = this.toLocal(canonicalArgs, targetProjectRoot);
      }
      if (ev.output && typeof ev.output === 'string') {
        const canonicalOutput = sourceRoot ? this.toCanonical(ev.output, sourceRoot) : ev.output;
        ev.output = this.toLocal(canonicalOutput, targetProjectRoot);
      }
    }

    return rebased;
  }
}
