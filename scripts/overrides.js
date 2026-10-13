(() => {
  'use strict';

  // 抽屉菜单：无后端能力的菜单项
  const MENU_HIDE = ['个性分享', '版本说明', '捐赠打赏', '关于我们'];
  // 个人面板：无邮件服务/无审核流的按钮
  const BUTTON_HIDE = ['绑定邮箱', '申请称号', '称号管理', '变更称号', '重新申请'];

  const hide = (el) => {
    if (el && el.style) el.style.display = 'none';
  };
  const visible = (el) => el.offsetParent !== null && el.style.display !== 'none';
  const txt = (el) => (el.textContent || '').trim();

  // ===== 品牌替换兜底：修正渲染出的旧作者署名（含已持久化的 selfSetHtml）=====
  const REPO_URL = 'https://github.com/jeio258/cloudflare-tab';
  const GH_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="vertical-align:middle" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

  const fixAttribution = (a) => {
    const t = (a.textContent || '').trim();
    const href = a.getAttribute('href') || '';
    if (t === '@doxwant' || href.indexOf('github.com/dengxiwang') >= 0) {
      a.setAttribute('href', REPO_URL);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      if (t === '@doxwant') a.innerHTML = GH_ICON;
    }
  };

  // ===== 无验证码注册/找回：后端已不再校验验证码，自动填充并隐藏相关 UI =====
  const CODE_VALUE = '000000';
  const CODE_IDS = ['register-form_emailCode', 'findPassword-form_emailCode'];
  const neutralized = new WeakSet();

  function neutralizeEmailCode(buttons) {
    for (const id of CODE_IDS) {
      const input = document.getElementById(id);
      if (!input) continue;
      // 隐藏验证码表单项
      const item = input.closest('.ant-form-item');
      if (item) item.style.display = 'none';
      // 经 React 原生 setter 注入值，绕过 required 校验（仅首次）
      if (!neutralized.has(input)) {
        neutralized.add(input);
        try {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, CODE_VALUE);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        } catch {
          /* noop */
        }
      }
    }
    // 隐藏“获取验证码”按钮（后端接口已下线；复用扫描收集，不再整树遍历）
    for (const b of buttons) {
      if (txt(b) === '获取验证码') hide(b);
    }
  }

  // ===== 找回密码表单适配：后端要求原密码，前端表单未含该字段 =====
  const OLD_PW_ID = 'gotab-oldPassword';
  const FIND_PW_PATH = '/api/findPassword';

  function injectOldPwField() {
    const form = document.getElementById('findPassword-form');
    if (!form || form.querySelector('#' + OLD_PW_ID)) return;
    const anchor = form.querySelector('#findPassword-form_newPassword');
    const anchorItem = anchor ? anchor.closest('.ant-form-item') : null;

    const item = document.createElement('div');
    item.className = 'ant-form-item';
    item.style.marginBottom = '12px';

    const label = document.createElement('div');
    label.className = 'ant-form-item-label';
    const lab = document.createElement('label');
    lab.textContent = '原密码';
    lab.setAttribute('for', OLD_PW_ID);
    label.appendChild(lab);

    const wrap = document.createElement('div');
    wrap.className = 'ant-form-item-control';
    const ctrl = document.createElement('div');
    ctrl.className = 'ant-form-item-control-input';
    const input = document.createElement('input');
    input.id = OLD_PW_ID;
    input.type = 'password';
    input.autocomplete = 'current-password';
    input.placeholder = '请输入原密码';
    input.maxLength = 32;
    input.className = 'ant-input';
    ctrl.appendChild(input);
    wrap.appendChild(ctrl);
    item.appendChild(label);
    item.appendChild(wrap);

    if (anchorItem && anchorItem.parentNode) anchorItem.parentNode.insertBefore(item, anchorItem);
    else form.appendChild(item);
  }

  const readOldPw = () => {
    const el = document.getElementById(OLD_PW_ID);
    return el && el.value ? el.value : '';
  };

  function withOldPw(body) {
    if (typeof body !== 'string') return body;
    const v = readOldPw();
    if (!v) return body;
    try {
      const j = JSON.parse(body);
      if (j && typeof j === 'object' && !j.oldPassword) {
        j.oldPassword = v;
        return JSON.stringify(j);
      }
    } catch {
      /* 非 JSON 不动 */
    }
    return body;
  }

  // 拦截 XHR（axios 默认适配器）为 /api/findPassword 注入 oldPassword
  try {
    const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (proto && !proto.__gotabPatched) {
      const origOpen = proto.open;
      const origSend = proto.send;
      proto.open = function (method, url, ...rest) {
        this.__gotabUrl = String(url || '');
        return origOpen.call(this, method, url, ...rest);
      };
      proto.send = function (body) {
        if (String(this.__gotabUrl || '').indexOf(FIND_PW_PATH) >= 0) body = withOldPw(body);
        return origSend.call(this, body);
      };
      proto.__gotabPatched = true;
    }
  } catch {
    /* noop */
  }

  // fetch 兜底（若改用 fetch）
  try {
    const origFetch = window.fetch;
    if (origFetch && !origFetch.__gotabPatched) {
      const patched = function (input, init) {
        try {
          const url = typeof input === 'string' ? input : input && input.url ? input.url : '';
          if (url.indexOf(FIND_PW_PATH) >= 0 && init && typeof init.body === 'string') {
            init = Object.assign({}, init, { body: withOldPw(init.body) });
          }
        } catch {
          /* noop */
        }
        return origFetch.call(this, input, init);
      };
      patched.__gotabPatched = true;
      window.fetch = patched;
    }
  } catch {
    /* noop */
  }

  // ===== 无障碍：为无文本的图标按钮补 aria-label（提升 a11y，零视觉变化）=====
  const ICON_LABEL = {
    'anticon-setting': '设置',
    'anticon-user': '用户中心',
    'anticon-appstore': '功能面板',
    'anticon-edit': '编辑',
    'anticon-like': '点赞',
    'anticon-right': '下一页',
    'anticon-left': '上一页',
    'anticon-menu': '菜单',
    'anticon-close': '关闭',
    'anticon-plus': '添加',
    'anticon-search': '搜索',
    'anticon-upload': '上传',
  };

  const fixIconLabel = (btn) => {
    if (btn.getAttribute('aria-label') || btn.getAttribute('title')) return;
    if (txt(btn)) return;
    const icon = btn.querySelector('[class*="anticon-"]');
    let label = '';
    if (icon) {
      const m = String(icon.className).match(/anticon-[a-z0-9-]+/);
      if (m) label = ICON_LABEL[m[0]] || '';
    }
    if (!label) {
      const img = btn.querySelector('img[alt]');
      const alt = img ? (img.getAttribute('alt') || '').trim() : '';
      label = alt || '快捷操作';
    }
    btn.setAttribute('aria-label', label);
  };

  // 一次全文档遍历覆盖所有隐藏/标注动作（原 5 次 querySelectorAll 合并为 1 次）
  const SCAN_SEL =
    '.ant-menu-item, .ant-menu-submenu-title, li[role="menuitem"], button, .ant-menu-item-group, a';

  function scanImpl() {
    const items = [];
    const buttons = [];
    const groups = [];
    const anchors = [];
    for (const el of document.querySelectorAll(SCAN_SEL)) {
      if (el.tagName === 'BUTTON') buttons.push(el);
      else if (el.tagName === 'A') anchors.push(el);
      else if (el.classList.contains('ant-menu-item-group')) groups.push(el);
      else items.push(el);
    }

    // 抽屉/菜单项
    for (const el of items) {
      const t = txt(el);
      if (t && MENU_HIDE.some((h) => t.includes(h))) hide(el);
    }

    // 按钮级隐藏（按文案精确匹配，避免误伤）
    for (const b of buttons) {
      const t = txt(b);
      if (!t) continue;
      if (BUTTON_HIDE.some((h) => t === h)) hide(b);
      // 纯"上传"按钮：后端未实现上传
      if (t === '上传') hide(b);
    }

    // 空分组头清理
    for (const g of groups) {
      const own = items.filter((i) => g.contains(i));
      if (own.length && own.every((i) => !visible(i))) hide(g);
    }

    // 品牌替换兜底
    for (const a of anchors) fixAttribution(a);
    // 无障碍：图标按钮补可访问名（保持原作用域：仅 antd/icon 类按钮）
    for (const b of buttons) {
      if (b.matches('button.ant-btn, button[class*="ant-btn"], button[class*="icon"]')) fixIconLabel(b);
    }

    // 找回密码表单：注入原密码输入
    injectOldPwField();

    // 无验证码注册/找回：隐藏验证码 UI 并自动填充
    neutralizeEmailCode(buttons);
  }

  let pending = false;
  const requestScan = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      scan();
    });
  };

  // 页面结构变化时静默降级，避免影响应用
  function scan() {
    try {
      scanImpl();
    } catch {
      /* noop */
    }
  }

  // 突变相关性过滤：仅当新增节点含本补丁关心的元素才重扫
  // （时钟/挂件等无关重渲染不再触发整树遍历；form/input 覆盖验证码与找回表单的再挂载）
  const RELEVANT_SEL = SCAN_SEL + ', form, input';
  const relevantMutation = (records) =>
    records.some((r) =>
      [...r.addedNodes].some(
        (n) => n.nodeType === 1 && (n.matches(RELEVANT_SEL) || n.querySelector(RELEVANT_SEL))
      )
    );

  scan();
  new MutationObserver((records) => {
    if (relevantMutation(records)) requestScan();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
