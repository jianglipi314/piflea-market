/* ============ Supabase Client ============ */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * A lightweight REST-based Supabase client.
 * For production, replace with official @supabase/supabase-js SDK.
 */
function createRestSupabaseClient(url, key) {
  const restHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  function makeBuilder(table) {
    const state = {
      table,
      action: 'select',
      body: null,
      filters: [],
      orderBy: null,
      orExpr: '',
      singleRow: false,
      limit: null,
    };

    const builder = {
      select() {
        if (state.action !== 'insert' && state.action !== 'update') state.action = 'select';
        return builder;
      },
      insert(body) { state.action = 'insert'; state.body = body; return builder; },
      update(body) { state.action = 'update'; state.body = body; return builder; },
      delete() { state.action = 'delete'; return builder; },
      eq(col, val) { state.filters.push([col, val]); return builder; },
      limit(n) { state.limit = n; return builder; },
      order(col, opts) {
        state.orderBy = [col, opts && opts.ascending !== false ? 'asc' : 'desc'];
        return builder;
      },
      or(expr) { state.orExpr = expr; return builder; },
      single() { state.singleRow = true; return builder; },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };

    async function execute() {
      const endpoint = new URL(`${url}/rest/v1/${state.table}`);
      endpoint.searchParams.set('select', '*');
      state.filters.forEach(([col, val]) => endpoint.searchParams.set(col, `eq.${val}`));
      if (state.orExpr) endpoint.searchParams.set('or', `(${state.orExpr})`);
      if (state.orderBy) {
        endpoint.searchParams.set('order', `${state.orderBy[0]}.${state.orderBy[1]}`);
      }
      if (state.limit) {
        endpoint.searchParams.set('limit', state.limit);
      }

      const options = { headers: { ...restHeaders, Prefer: 'return=representation' } };

      if (state.action === 'insert') {
        options.method = 'POST';
        options.body = JSON.stringify(state.body);
      } else if (state.action === 'update') {
        options.method = 'PATCH';
        options.body = JSON.stringify(state.body);
      } else if (state.action === 'delete') {
        options.method = 'DELETE';
      } else {
        options.method = 'GET';
      }

      try {
        const res = await fetch(endpoint.toString(), options);
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) {
          return { data: null, error: data || { message: res.statusText } };
        }
        return {
          data: state.singleRow && Array.isArray(data) ? data[0] : data,
          error: null,
        };
      } catch (error) {
        return { data: null, error };
      }
    }

    return builder;
  }

  return {
    from(table) { return makeBuilder(table); },
    channel(name) {
      // Minimal Supabase Realtime channel mock.
      // For production: use supabase-js SDK which supports channels natively.
      return {
        on(type, filter, callback) {
          // No-op in REST mode; real-time not supported without official SDK
          console.warn('Realtime channel requires @supabase/supabase-js SDK');
          return this;
        },
        subscribe() {
          console.warn('Realtime subscribe requires @supabase/supabase-js SDK');
        },
        unsubscribe() {},
      };
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, bytes, opts) {
            try {
              const res = await fetch(
                `${url}/storage/v1/object/${bucket}/${path}`,
                {
                  method: 'POST',
                  headers: {
                    apikey: key,
                    Authorization: `Bearer ${key}`,
                    'Content-Type':
                      (opts && opts.contentType) || 'application/octet-stream',
                  },
                  body: bytes,
                }
              );
              if (!res.ok) {
                const err = await res.json().catch(() => ({ message: res.statusText }));
                return { data: null, error: err };
              }
              return { data: await res.json().catch(() => ({})), error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
          getPublicUrl(path) {
            return {
              data: {
                publicUrl: `${url}/storage/v1/object/public/${bucket}/${path}`,
              },
            };
          },
        };
      },
    },
  };
}

let supabaseClient = null;

export function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = createRestSupabaseClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabaseClient;
}

/**
 * Decode an item from Supabase row format to app format
 */
export function decodeItem(d) {
  return {
    id: d.id,
    title: d.title,
    price: d.price,
    cat: d.category,
    seller: d.seller,
    emoji: getCatIcon(d.category),
    desc: d.description || '',
    images: d.images || [],
    city: d.city || '',
    contact: d.contact || '',
    fav: d.fav_count || 0,
    owner_id: d.owner_id || '',
    views: d.views || 0,
    tpl: d.tpl ?? '',
    status: d.status || 'active',
    createdAt: new Date(d.created_at).getTime(),
  };
}

function getCatIcon(cat) {
  const icons = {
    '数码': '📱', '生活': '🏠', '美妆': '💄', '图书': '📚',
    '服饰': '👕', '母婴': '🍼', '运动': '⚽',
  };
  return icons[cat] || '📦';
}
