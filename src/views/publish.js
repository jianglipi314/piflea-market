/* ============ Publish View ============ */

import { getSupabase } from '../supabase';
import { state } from '../main';
import { CAT_ICON, LOC_KEY } from '../state';
import { getPiUser } from '../pi-sdk';
import { escapeHtml, fmtPrice, toast, getCurrentUserId, getAllMyUserIds } from '../utils';
import { goto } from '../router';

let shippingMode = 'free'; // 'free' or 'fee'

export function initShippingToggle() {
  const btnFree = document.getElementById('ship-free');
  const btnFee = document.getElementById('ship-fee');
  const input = document.getElementById('f-shipping');
  if (!btnFree || !btnFee) return;

  btnFree.addEventListener('click', () => {
    shippingMode = 'free';
    btnFree.style.background = 'var(--ink)';
    btnFree.style.color = '#fff';
    btnFee.style.background = 'var(--card)';
    btnFee.style.color = 'var(--ink-2)';
    input.style.display = 'none';
    input.value = '';
  });

  btnFee.addEventListener('click', () => {
    shippingMode = 'fee';
    btnFee.style.background = 'var(--ink)';
    btnFee.style.color = '#fff';
    btnFree.style.background = 'var(--card)';
    btnFree.style.color = 'var(--ink-2)';
    input.style.display = 'block';
    input.focus();
  });
}

export function getShippingFee() {
  if (shippingMode === 'free') return 0;
  const val = parseFloat(document.getElementById('f-shipping').value) || 0;
  return val;
}

export function resetShippingToggle() {
  shippingMode = 'free';
  const btnFree = document.getElementById('ship-free');
  const btnFee = document.getElementById('ship-fee');
  const input = document.getElementById('f-shipping');
  if (btnFree) { btnFree.style.background = 'var(--ink)'; btnFree.style.color = '#fff'; }
  if (btnFee) { btnFee.style.background = 'var(--card)'; btnFee.style.color = 'var(--ink-2)'; }
  if (input) { input.style.display = 'none'; input.value = ''; }
}

/* ============ City Dropdown (Province → City) ============ */
const PROVINCE_CITY = {
  '北京': ['北京市'],
  '上海': ['上海市'],
  '天津': ['天津市'],
  '重庆': ['重庆市'],
  '广东': ['广州', '深圳', '珠海', '佛山', '东莞', '中山', '惠州', '汕头', '江门', '湛江', '肇庆', '茂名', '阳江', '清远', '韶关', '梅州', '潮州', '河源', '云浮', '揭阳'],
  '江苏': ['南京', '苏州', '无锡', '常州', '徐州', '南通', '扬州', '镇江', '泰州', '盐城', '淮安', '连云港', '宿迁'],
  '浙江': ['杭州', '宁波', '温州', '绍兴', '嘉兴', '金华', '台州', '湖州', '丽水', '衢州', '舟山'],
  '山东': ['济南', '青岛', '烟台', '潍坊', '淄博', '威海', '临沂', '济宁', '泰安', '德州', '聊城', '滨州', '东营', '菏泽', '日照', '枣庄', '莱芜'],
  '河南': ['郑州', '洛阳', '开封', '新乡', '南阳', '安阳', '焦作', '许昌', '商丘', '周口', '驻马店', '信阳', '平顶山', '濮阳', '鹤壁', '漯河', '三门峡', '济源'],
  '四川': ['成都', '绵阳', '德阳', '南充', '宜宾', '泸州', '乐山', '自贡', '内江', '达州', '广元', '遂宁', '眉山', '雅安', '资阳', '广安', '攀枝花', '巴中'],
  '湖北': ['武汉', '宜昌', '襄阳', '荆州', '黄冈', '十堰', '孝感', '荆门', '鄂州', '黄石', '咸宁', '随州', '恩施', '仙桃', '天门', '潜江'],
  '湖南': ['长沙', '株洲', '湘潭', '衡阳', '常德', '岳阳', '郴州', '邵阳', '益阳', '永州', '怀化', '娄底', '湘西', '张家界'],
  '河北': ['石家庄', '唐山', '保定', '邯郸', '廊坊', '沧州', '秦皇岛', '张家口', '邢台', '衡水', '承德', '定州', '辛集'],
  '福建': ['福州', '厦门', '泉州', '漳州', '莆田', '宁德', '龙岩', '三明', '南平'],
  '安徽': ['合肥', '芜湖', '蚌埠', '阜阳', '安庆', '马鞍山', '滁州', '宿州', '六安', '亳州', '宣城', '黄山', '淮南', '淮北', '铜陵', '池州'],
  '辽宁': ['沈阳', '大连', '鞍山', '抚顺', '本溪', '丹东', '锦州', '营口', '阜新', '辽阳', '盘锦', '铁岭', '朝阳', '葫芦岛'],
  '黑龙江': ['哈尔滨', '齐齐哈尔', '大庆', '牡丹江', '佳木斯', '绥化', '鸡西', '鹤岗', '双鸭山', '伊春', '七台河', '黑河', '大兴安岭'],
  '吉林': ['长春', '吉林', '四平', '通化', '白城', '辽源', '松原', '白山', '延边'],
  '江西': ['南昌', '赣州', '九江', '上饶', '宜春', '吉安', '抚州', '萍乡', '新余', '鹰潭', '景德镇'],
  '陕西': ['西安', '宝鸡', '咸阳', '渭南', '汉中', '榆林', '延安', '安康', '商洛', '铜川'],
  '山西': ['太原', '大同', '运城', '临汾', '长治', '晋城', '忻州', '吕梁', '阳泉', '朔州'],
  '云南': ['昆明', '曲靖', '大理', '红河', '玉溪', '楚雄', '文山', '保山', '昭通', '普洱', '临沧', '丽江', '德宏', '迪庆', '西双版纳', '怒江'],
  '贵州': ['贵阳', '遵义', '毕节', '铜仁', '六盘水', '安顺', '黔东南', '黔南', '黔西南'],
  '广西': ['南宁', '柳州', '桂林', '玉林', '梧州', '钦州', '北海', '贵港', '百色', '河池', '来宾', '贺州', '崇左', '防城港'],
  '海南': ['海口', '三亚', '儋州', '三沙'],
  '甘肃': ['兰州', '天水', '白银', '庆阳', '平凉', '定西', '陇南', '武威', '张掖', '酒泉', '嘉峪关', '金昌', '临夏', '甘南'],
  '青海': ['西宁', '海东', '海北', '黄南', '海南州', '果洛', '玉树', '海西'],
  '内蒙古': ['呼和浩特', '包头', '鄂尔多斯', '赤峰', '通辽', '呼伦贝尔', '巴彦淖尔', '乌兰察布', '兴安盟', '锡林郭勒', '阿拉善', '乌海'],
  '宁夏': ['银川', '吴忠', '石嘴山', '中卫', '固原'],
  '新疆': ['乌鲁木齐', '喀什', '伊犁', '昌吉', '阿克苏', '巴音郭楞', '哈密', '吐鲁番', '塔城', '博尔塔拉', '阿勒泰', '克孜勒苏', '和田', '克拉玛依'],
  '西藏': ['拉萨', '日喀则', '昌都', '林芝', '山南', '那曲', '阿里'],
};

export function initCityDropdown() {
  const input = document.getElementById('f-city');
  const dropdown = document.getElementById('city-dropdown');
  if (!input || !dropdown || input._cityBound) return;
  input._cityBound = true;

  function showProvinces() {
    const provinces = Object.keys(PROVINCE_CITY);
    dropdown.innerHTML = '<div style="padding:8px 14px;font-size:11px;color:var(--ink-2);font-weight:600">选择省份</div>' +
      provinces.map(p =>
        '<div class="city-item" data-province="' + p + '" style="padding:10px 14px;font-size:14px;cursor:pointer;border-radius:4px;display:flex;justify-content:space-between;align-items:center">' +
        '<span>' + p + '</span><span style="color:var(--ink-2);font-size:12px">›</span></div>'
      ).join('');
    dropdown.style.display = 'block';
  }

  function showCities(province) {
    const cities = PROVINCE_CITY[province] || [];
    dropdown.innerHTML = '<div style="padding:8px 14px;font-size:11px;color:var(--ink-2);font-weight:600;display:flex;align-items:center;gap:6px">' +
      '<span data-back="1" style="cursor:pointer;color:var(--brand);font-size:14px">‹</span>' +
      '<span>' + province + ' · 选择城市</span></div>' +
      cities.map(c =>
        '<div class="city-item" data-city="' + c + '" style="padding:10px 14px;font-size:14px;cursor:pointer;border-radius:4px">' + c + '</div>'
      ).join('');
    dropdown.style.display = 'block';
  }

  input.addEventListener('focus', () => {
    showProvinces();
  });

  input.addEventListener('click', () => {
    showProvinces();
  });

  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const prov = e.target.closest('[data-province]');
    const city = e.target.closest('[data-city]');
    const back = e.target.closest('[data-back]');
    if (prov) {
      showCities(prov.dataset.province);
    } else if (city) {
      input.value = city.dataset.city;
      dropdown.style.display = 'none';
    } else if (back) {
      showProvinces();
    }
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}
import { loadItems } from './home';

const IMAGE_MAX_WIDTH = 800;
const IMAGE_QUALITY = 0.85;

let uploadImages = [];

let formListenerBound = false;
export function initFormListener() {
  if (formListenerBound) return;
  const submitBtn = document.getElementById('f-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      doPublish({ preventDefault: function(){} });
    });
  }
  const form = document.getElementById('publishForm');
  if (form) {
    form.addEventListener('submit', function(ev) { ev.preventDefault(); doPublish(ev); });
  }
  // 上传区点击（含动态生成的 + 按钮 / 删除按钮）改由 #uploader 事件委托处理，
  // 这里仅保留文件选择 change 监听。
  const fileInput = document.getElementById('f-files');
  if (fileInput) {
    fileInput.addEventListener('change', function(ev) { onFiles(ev); });
  }
  const clearBtn = document.querySelector('.actions .btn.ghost');
  if (clearBtn) { clearBtn.addEventListener('click', function(ev) { ev.preventDefault(); clearForm(); }); }
  const previewBtn = document.getElementById('btnPreview');
  if (previewBtn) { previewBtn.addEventListener('click', function(ev) { ev.preventDefault(); togglePreview(); }); }
  initShippingToggle();
  initCityDropdown();
  formListenerBound = true;
}

/**
 * Clear the publish form.
 */
export function clearForm() {
  document.getElementById('publishForm').reset();
  uploadImages = [];
  renderUploader();
  document.getElementById('preview').style.display = 'none';
  setStep(1);
  resetShippingToggle();

  const submitBtn = document.getElementById('f-submit');
  if (submitBtn) submitBtn.textContent = '免费发布';
  state.editId = null;
}

function setStep(n) {
  document.querySelectorAll('#steps .step').forEach((s) => {
    const k = parseInt(s.dataset.step, 10);
    s.classList.toggle('on', k === n);
    s.classList.toggle('done', k < n);
  });
}

/**
 * Handle file selection.
 */
export async function onFiles(ev) {
  const files = [...(ev.target.files || [])];
  for (const f of files) {
    if (uploadImages.length >= 6) {
      toast('最多 6 张图片');
      break;
    }
    if (!f.type.startsWith('image/')) {
      toast('只能上传图片文件');
      continue;
    }
    try {
      toast('正在压缩图片...');
      const compressed = await compressImage(f);
      uploadImages.push(compressed);
      renderUploader();
    } catch (e) {
      console.error('compressImage error', e);
      toast('图片处理失败，请换一张图片');
    }
  }
  ev.target.value = '';
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式不支持'));
      img.onload = () => {
        const scale = Math.min(1, IMAGE_MAX_WIDTH / img.width);
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderUploader() {
  document.getElementById('uploader').innerHTML =
    uploadImages
      .map(
        (src, i) =>
          `<div class="thumb uploaded"><img src="${src}" loading="lazy" decoding="async"/><button type="button" class="x" data-remove="${i}">×</button></div>`
      )
      .join('') +
    (uploadImages.length < 6
      ? `<button type="button" class="thumb" data-add="1">＋</button>`
      : '');

  // 事件委托（替换内联 onclick，兼容 Pi Browser）
  const uploader = document.getElementById('uploader');
  if (uploader && !uploader.dataset.bound) {
    uploader.dataset.bound = '1';
    uploader.addEventListener('click', function(e) {
      const x = e.target.closest('[data-remove]');
      if (x) {
        e.stopPropagation();
        removeImg(Number(x.dataset.remove));
        return;
      }
      const add = e.target.closest('[data-add]');
      if (add) {
        e.stopPropagation();
        document.getElementById('f-files').click();
      }
    });
  }
}

export function removeImg(i) {
  uploadImages.splice(i, 1);
  renderUploader();
}

/**
 * Toggle preview panel.
 */
export function togglePreview() {
  const panel = document.getElementById('preview');
  if (!panel.style.display || panel.style.display === 'none') {
    panel.style.display = 'block';
    document.getElementById('previewBody').innerHTML = renderPreviewHTML();
    setStep(2);
  } else {
    panel.style.display = 'none';
    setStep(1);
  }
}

function renderPreviewHTML() {
  const title = document.getElementById('f-title').value || '（未填）';
  const cat = document.getElementById('f-cat').value;
  const price = parseFloat(document.getElementById('f-price').value) || 0;
  const desc = document.getElementById('f-desc').value || '（未填）';
  const piUser = getPiUser();
  const seller = piUser ? (piUser.username || 'Pi用户') : 'Pi用户';
  const city = document.getElementById('f-city').value || '';

  return `<div class="card" style="box-shadow:none;border:1px solid var(--line);cursor:default">
    <div class="pic" style="height:160px">${
      uploadImages[0]
        ? `<img src="${uploadImages[0]}" loading="lazy" decoding="async"/>`
        : CAT_ICON[cat] || '📦'
    }</div>
    <div class="info"><p class="title">${escapeHtml(title)}</p>
      <div class="price-row"><div class="price">${fmtPrice(price)}<small> π</small></div><div style="font-size:11px;color:var(--ink-2)">${cat}${city ? ' · ' + escapeHtml(city) : ''}</div></div>
      <div class="seller"><div class="avatar">${escapeHtml(seller.slice(0, 1))}</div><span>${escapeHtml(seller)}</span></div>
    </div></div><div style="font-size:12px;color:var(--ink-2);margin-top:8px">${escapeHtml(desc)}</div>`;
}

async function uploadImageToSupabase(base64Data, filename) {
  const supabase = getSupabase();
  const base64 = base64Data.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = filename.split('.').pop() || 'jpg';
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('images').upload(path, bytes, {
    contentType: `image/${ext}`,
  });
  if (error) throw error;
  const { data: urlData } = supabase.storage.from('images').getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * Submit the publish form.
 */
export async function doPublish(ev) {
  console.log('[doPublish] called');
  if (ev) ev.preventDefault();
  
  const btn = document.getElementById('f-submit');
  console.log('[doPublish] btn disabled:', btn?.disabled, 'uploading:', state.uploading);
  
  if (state.uploading) {
    console.log('[doPublish] uploading is true, returning');
    return;
  }

  const title = document.getElementById('f-title').value.trim();
  const cat = document.getElementById('f-cat').value;
  const priceRaw = document.getElementById('f-price').value.trim();
  const desc = document.getElementById('f-desc').value.trim();
  const city = document.getElementById('f-city').value.trim();
  const contact = document.getElementById('f-contact').value.trim();
  const price = parseFloat(priceRaw);

  // 自动获取 Pi 用户名作为卖家名
  const piUser = getPiUser();
  const seller = piUser ? (piUser.username || ('pi_' + (piUser.uid || '').slice(0, 8))) : 'Pi用户';
  if (!piUser) { toast('请先登录 Pi 账号'); return false; }

  // Validation
  if (title.length < 2) { toast('商品标题至少 2 个字'); return false; }
  if (title.length > 40) { toast('商品标题最多 40 个字'); return false; }
  if (!price || price <= 0) { toast('请填写合理的价格'); return false; }
  if (price > 1000000) { toast('价格过高，请确认'); return false; }
  if (desc.length < 4) { toast('商品描述至少 4 个字'); return false; }
  if (desc.length > 500) { toast('商品描述最多 500 个字'); return false; }
  if (contact.length > 30) { toast('联系方式最多 30 个字'); return false; }
  if (city.length > 20) { toast('所在城市最多 20 个字'); return false; }

  btn.disabled = true;
  btn.textContent = '上传图片中...';
  state.uploading = true;

  try {
    const uploadedUrls = [];
    for (let i = 0; i < uploadImages.length; i++) {
      btn.textContent = `上传图片 ${i + 1}/${uploadImages.length}...`;
      const url = await uploadImageToSupabase(uploadImages[i], `img_${i}.jpg`);
      uploadedUrls.push(url);
    }
    await submitItem({
      title, price, cat, desc, seller, city, contact,
      shipping_fee: getShippingFee(),
      images: uploadedUrls,
      owner_id: getCurrentUserId(),
    });
  } catch (e) {
    toast('发布失败：' + (e.message || '未知错误'));
    btn.disabled = false;
    btn.textContent = '免费发布';
    state.uploading = false;
  }
  return false;
}

async function submitItem(data) {
  const btn = document.getElementById('f-submit');
  const supabase = getSupabase();
  const isEdit = !!state.editId;
  btn.textContent = isEdit ? '保存修改中...' : '保存到云端...';

  let result, error;
  if (isEdit) {
    ({ data: result, error } = await supabase
      .from('items')
      .update({
        title: data.title,
        price: data.price,
        category: data.cat,
        description: data.desc,
        seller: data.seller,
        city: data.city,
        contact: data.contact || '',
        shipping_fee: data.shipping_fee || 0,
        images: data.images,
      })
      .eq('id', state.editId)
      .select()
      .single());
  } else {
    ({ data: result, error } = await supabase
      .from('items')
      .insert({
        title: data.title,
        price: data.price,
        category: data.cat,
        description: data.desc,
        seller: data.seller,
        city: data.city,
        contact: data.contact || '',
        shipping_fee: data.shipping_fee || 0,
        images: data.images,
        views: 0,
        fav_count: 0,
        status: 'active',
        owner_id: data.owner_id,
      })
      .select()
      .single());
  }

  if (error) {
    toast('保存失败：' + error.message);
    btn.disabled = false;
    btn.textContent = isEdit ? '保存修改' : '免费发布';
    state.uploading = false;
    return;
  }

  toast(isEdit ? '✅ 修改成功' : '✅ 发布成功！商品已同步到云端');
  setStep(3);
  state.editId = null;
  clearForm();

  setTimeout(() => {
    loadItems();
    goto('mine');
  }, 800);

  btn.disabled = false;
  btn.textContent = '免费发布';
  state.uploading = false;
}

/**
 * Open edit mode for an existing item.
 */
export async function openEdit(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) { toast('商品不存在'); return; }

  const myIds = getAllMyUserIds();
  const isMine = it.owner_id
    ? myIds.includes(it.owner_id)
    : false;
  if (!isMine) { toast('无权编辑此商品'); return; }

  // Navigate first, then set editId (so goto can clear stale editId)
  goto('publish');
  state.editId = id;
  document.getElementById('topTitle').textContent = '编辑商品';
  document.getElementById('topSub').textContent = '修改信息后保存';

  document.getElementById('f-title').value = it.title || '';
  document.getElementById('f-cat').value = it.cat || '数码';
  document.getElementById('f-price').value = it.price || '';
  document.getElementById('f-city').value = it.city || '';
  document.getElementById('f-desc').value = it.desc || '';
  document.getElementById('f-contact').value = it.contact || '';

  // Restore images from URLs
  uploadImages = (it.images || []).slice();
  renderUploader();
}
