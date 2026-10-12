export function computeWorkBuddySlug(dirPath) {
  if (!dirPath) return 'global';

  let p = dirPath.trim();
  p = p.replace(/^([a-zA-Z]):/, (match, drive) => drive.toLowerCase());
  p = p.replace(/[\\/]+/g, '-');
  p = p.replace(/^-+|-+$/g, '');

  return p || 'default';
}

