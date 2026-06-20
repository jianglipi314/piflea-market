/* ============ Global State ============ */

const CATS = ['全部', '数码', '生活', '美妆', '图书', '服饰', '母婴', '运动'];
const CAT_ICON = {
  '数码': '📱', '生活': '🏠', '美妆': '💄', '图书': '📚',
  '服饰': '👕', '母婴': '🍼', '运动': '⚽', '全部': '🔥'
};
const HOT_TAGS = ['iPhone', 'Switch', '宜家', 'Kindle', '双肩包', 'AirPods', '绘本', '相机', '滑板', '美妆蛋'];

// localStorage keys
const LOC_KEY = 'pi_flea_loc_v3';
const DARK_KEY = 'pi_flea_dark_v3';
const HIST_KEY = 'pi_flea_hist_v3';
const CHAT_KEY = 'pi_flea_chats_v3';
const ADMIN_KEY = 'pi_flea_admin_v3';
const ADMIN_CLICK_KEY = 'pi_flea_admin_clicks';

export { CATS, CAT_ICON, HOT_TAGS, LOC_KEY, DARK_KEY, HIST_KEY, CHAT_KEY, ADMIN_KEY, ADMIN_CLICK_KEY };

/**
 * Create the global app state.
 * This is a simple mutable object — views read/write it directly.
 */
export function createState() {
  return {
    items: [],
    dark: parseInt(localStorage.getItem(DARK_KEY) || '0'),
    sort: 'new',
    cat: '全部',
    onlyReco: false,
    currentDetailId: null,
    mineTab: 'post',
    history: JSON.parse(localStorage.getItem(HIST_KEY) || '[]'),
    chats: JSON.parse(localStorage.getItem(CHAT_KEY) || '{}'),
    admin: parseInt(localStorage.getItem(ADMIN_KEY) || '0'),
    adminClicks: parseInt(localStorage.getItem(ADMIN_CLICK_KEY) || '0'),
    city: localStorage.getItem(LOC_KEY) || '',
    uploading: false,
    editId: null,
  };
}
