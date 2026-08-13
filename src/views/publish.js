/* ============ Publish View ============ */

import { getSupabase } from '../supabase';
import { state } from '../main';
import { CAT_ICON, LOC_KEY } from '../state';
import { getPiUser } from '../pi-sdk';
import { escapeHtml, fmtPrice, toast, getCurrentUserId, getAllMyUserIds } from '../utils';
import { goto } from '../router';
import { PROVINCE_CITY } from '../data/region.js';

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
  return Math.max(0, val);
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
  // 返回按钮：回到来源页（编辑时回"我的发布"，发布时回首页）
  const backBtn = document.getElementById('publish-back-btn');
  if (backBtn && !backBtn._bound) {
    backBtn._bound = true;
    backBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      const target = state.publishReturnTo || 'home';
      goto(target);
      // 回到"我的"时恢复之前的 tab（如"我的发布"）
      if (target === 'mine' && state.mineTab) {
        import('./mine').then((mod) => mod.switchMine(state.mineTab));
      }
    });
  }
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

  // 初始化上传器事件委托
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
        return;
      }
      // 点击已上传图片 → 全屏预览
      const img = e.target.closest('.thumb.uploaded img');
      if (img) {
        e.stopPropagation();
        const parent = img.closest('.thumb.uploaded');
        const idx = parent ? Number(parent.querySelector('[data-remove]')?.dataset.remove) : -1;
        if (idx >= 0) openImagePreview(idx);
      }
    });
  }

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
 * Open full-screen image preview for publish thumbnails.
 */
function openImagePreview(idx) {
  const overlay = document.createElement('div');
  overlay.className = 'image-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  const img = document.createElement('img');
  img.src = uploadImages[idx];
  img.alt = '';
  overlay.appendChild(img);
  document.body.appendChild(overlay);
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
  if (ev) ev.preventDefault();

  const btn = document.getElementById('f-submit');

  if (state.uploading) {
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

  setTimeout(() => {
    clearForm();
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

  // 记录来源页（编辑通常从"我的发布"进入，返回时回到该页）
  const activeView = document.querySelector('.view.active');
  const fromView = activeView ? activeView.id.replace('view-', '') : 'home';
  if (fromView !== 'publish') {
    state.publishReturnTo = fromView;
  }

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

  // Restore shipping fee
  if (it.shipping_fee > 0) {
    shippingMode = 'fee';
    const btnFree = document.getElementById('ship-free');
    const btnFee = document.getElementById('ship-fee');
    const shipInput = document.getElementById('f-shipping');
    if (btnFree) { btnFree.style.background = 'var(--card)'; btnFree.style.color = 'var(--ink-2)'; }
    if (btnFee) { btnFee.style.background = 'var(--ink)'; btnFee.style.color = '#fff'; }
    if (shipInput) { shipInput.style.display = 'block'; shipInput.value = it.shipping_fee; }
  }

  // Restore images from URLs
  uploadImages = (it.images || []).slice();
  renderUploader();
}
