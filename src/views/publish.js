/* ============ Publish View ============ */

import { getSupabase } from '../supabase';
import { state } from '../main';
import { CAT_ICON, LOC_KEY } from '../state';
import { escapeHtml, fmtPrice, toast, getCurrentUserId, getAllMyUserIds } from '../utils';
import { goto } from '../router';
import { loadItems } from './home';

const IMAGE_MAX_WIDTH = 800;
const IMAGE_QUALITY = 0.85;

let uploadImages = [];

/**
 * Clear the publish form.
 */
export function clearForm() {
  document.getElementById('publishForm').reset();
  uploadImages = [];
  renderUploader();
  document.getElementById('preview').style.display = 'none';
  setStep(1);

  const me = localStorage.getItem('pi_flea_me');
  if (me) document.getElementById('f-seller').value = me;

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
          `<div class="thumb uploaded"><img src="${src}" loading="lazy" decoding="async"/><button type="button" class="x" onclick="window.removeImg(${i})">×</button></div>`
      )
      .join('') +
    (uploadImages.length < 6
      ? `<button type="button" class="thumb" onclick="document.getElementById('f-files').click()">＋</button>`
      : '');
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
  const seller = document.getElementById('f-seller').value || '你';
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
  ev.preventDefault();
  if (state.uploading) return;

  const title = document.getElementById('f-title').value.trim();
  const cat = document.getElementById('f-cat').value;
  const priceRaw = document.getElementById('f-price').value.trim();
  const desc = document.getElementById('f-desc').value.trim();
  const seller = document.getElementById('f-seller').value.trim();
  const city = document.getElementById('f-city').value.trim();
  const contact = document.getElementById('f-contact').value.trim();
  const price = parseFloat(priceRaw);

  // Validation
  if (title.length < 2) { toast('商品标题至少 2 个字'); return false; }
  if (title.length > 40) { toast('商品标题最多 40 个字'); return false; }
  if (!price || price <= 0) { toast('请填写合理的价格'); return false; }
  if (price > 1000000) { toast('价格过高，请确认'); return false; }
  if (desc.length < 4) { toast('商品描述至少 4 个字'); return false; }
  if (desc.length > 500) { toast('商品描述最多 500 个字'); return false; }
  if (!seller || seller.length < 2) { toast('请填写卖家昵称'); return false; }
  if (seller.length > 16) { toast('卖家昵称最多 16 个字'); return false; }
  if (contact.length > 30) { toast('联系方式最多 30 个字'); return false; }
  if (city.length > 20) { toast('所在城市最多 20 个字'); return false; }

  localStorage.setItem('pi_flea_me', seller);

  const btn = document.getElementById('f-submit');
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

  const me = localStorage.getItem('pi_flea_me') || '';
  const myIds = getAllMyUserIds();
  const isMine = it.owner_id
    ? myIds.includes(it.owner_id)
    : (it.seller || '') === me;
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
  document.getElementById('f-seller').value = it.seller || '';
  document.getElementById('f-contact').value = it.contact || '';

  // Restore images from URLs
  uploadImages = (it.images || []).slice();
  renderUploader();
}
