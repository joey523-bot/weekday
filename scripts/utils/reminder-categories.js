export const DEFAULT_CATEGORIES = ['带东西', '买东西', '售后', '其他'];
export const CATEGORY_MAX_LENGTH = 20;
export function normalizeCustomCategories(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(v => typeof v === 'string')
    .map(v => v.trim()).filter(v => v && [...v].length <= CATEGORY_MAX_LENGTH && !DEFAULT_CATEGORIES.includes(v)))];
}
export function validateNewCategory(value, existing = []) {
  const name = String(value || '').trim();
  if (!name) throw new Error('请输入分类名称');
  if ([...name].length > CATEGORY_MAX_LENGTH) throw new Error('分类名称最多20个字');
  if ([...DEFAULT_CATEGORIES, ...existing].includes(name)) throw new Error('这个分类已经有了');
  return name;
}
export function categoryOptions(custom = [], legacy = '') {
  const result = [...DEFAULT_CATEGORIES, ...normalizeCustomCategories(custom)];
  if (legacy && !result.includes(legacy)) result.push(legacy);
  return result;
}
