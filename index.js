// 扩展名称和常量
const EXTENSION_NAME = "museum_importer";
const EXTENSION_ID = "museum-extension-root"; // 唯一的 DOM ID

// 全局变量
let supabase = null;
let session = null;
let currentFilter = 'all';

// --- 核心工具函数 ---

// 获取 ST 上下文
const getContext = () => {
    return window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : null;
}

// 获取扩展设置（安全版）
function getExtensionSettings() {
    const context = getContext();
    if (context && context.extensionSettings) {
        return context.extensionSettings;
    }
    // 回退兼容
    if (window.extension_settings) {
        return window.extension_settings;
    }
    return {};
}

// 保存设置
function saveExtensionSettings() {
    const context = getContext();
    if (context && context.saveSettingsDebounced) {
        context.saveSettingsDebounced();
    }
}

// 通用 Toast 通知
const toast = {
    success: (msg) => window.toastr ? window.toastr.success(msg) : console.log("[Museum] " + msg),
    error: (msg) => window.toastr ? window.toastr.error(msg) : console.error("[Museum] " + msg),
    info: (msg) => window.toastr ? window.toastr.info(msg) : console.log("[Museum] " + msg),
    warning: (msg) => window.toastr ? window.toastr.warning(msg) : console.warn("[Museum] " + msg)
};

// --- Supabase 逻辑 ---
async function loadSupabase() {
    if (window.supabase) return;
    
    // 备选 CDN 列表
    const sources = [
        "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js",
        "https://cdnjs.cloudflare.com/ajax/libs/supabase.js/2.39.7/supabase.min.js",
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.8/dist/umd/supabase.min.js"
    ];

    console.log("[Museum] 正在加载 Supabase SDK...");

    const tryLoadScript = (url) => {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => {
                console.log(`[Museum] 成功从 ${url} 加载 SDK`);
                resolve();
            };
            script.onerror = () => {
                console.warn(`[Museum] 无法加载: ${url}`);
                document.head.removeChild(script); 
                reject();
            };
            document.head.appendChild(script);
        });
    };

    for (const url of sources) {
        try {
            await tryLoadScript(url);
            return; 
        } catch (e) {
            continue;
        }
    }

    const errorMsg = "[Museum] 错误：所有 CDN 源均无法连接，请检查网络代理。";
    console.error(errorMsg);
    if (window.toastr) window.toastr.error("无法加载 Supabase 组件");
}

async function initSupabaseClient() {
    const settings = getExtensionSettings()[EXTENSION_NAME];
    
    if (!settings || !settings.sbUrl || !settings.sbKey) return false;
    if (!window.supabase) await loadSupabase();

    try {
        const createClient = window.supabase.createClient || window.supabase.default.createClient;
        supabase = createClient(settings.sbUrl, settings.sbKey);
        
        const { data } = await supabase.auth.getSession();
        if (data.session) {
            session = data.session;
            return true;
        } else if (settings.sbEmail && settings.sbPass) {
            return await doLogin();
        }
        return false;
    } catch (e) {
        console.error("[Museum] Supabase Init Error:", e);
        return false;
    }
}

async function doLogin() {
    if (!supabase) return false;
    const settings = getExtensionSettings()[EXTENSION_NAME];
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: settings.sbEmail,
            password: settings.sbPass
        });
        if (error) throw error;
        session = data.session;
        toast.success("博物馆登录成功");
        return true;
    } catch (e) {
        toast.error("登录失败: " + e.message);
        return false;
    }
}

// --- 数据获取与渲染 ---

async function refreshGallery() {
    const grid = $('#museum-grid');
    grid.empty();
    grid.append('<div class="museum-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>');

    const success = await initSupabaseClient();
    
    if (!success || !session) {
        grid.html('<div style="text-align:center; padding:20px; font-size:0.8em; opacity:0.7;">未连接。<br>请点击上方齿轮图标配置并登录。</div>');
        return;
    }

    try {
        let query = supabase.from("fragments").select("*").order("created_at", { ascending: false });
        
        if (currentFilter !== 'all') {
            query = query.eq('type', currentFilter);
        } else {
            query = query.in('type', ['role_card', 'beautify']);
        }

        const { data, error } = await query;
        if (error) throw error;

        renderItems(data || []);
    } catch (e) {
        toast.error("获取失败: " + e.message);
        grid.html('<div style="text-align:center; padding:20px;">加载失败</div>');
    }
}

function renderItems(items) {
    const grid = $('#museum-grid');
    grid.empty();

    if (items.length === 0) {
        grid.html('<div style="text-align:center; padding:20px; opacity: 0.7; color: var(--SmartThemeBodyColor);">暂无内容</div>');
        return;
    }

    items.forEach(item => {
        let title = "未命名";
        let typeLabel = "未知";
        let imgUrl = "";
        let variations = [];
        
        if (item.type === 'role_card') {
            typeLabel = "角色";
            try {
                if (item.content.startsWith('{')) {
                    const json = JSON.parse(item.content);
                    title = json.name || "未命名";
                } else {
                    title = item.content;
                }
                imgUrl = item.file_url;
            } catch (e) { title = item.content; }
        } 
        else if (item.type === 'beautify') {
            typeLabel = "美化";
            try {
                const json = JSON.parse(item.content);
                title = json.title || "主题";
                variations = json.variations || [];
                if (variations.length > 0) {
                    imgUrl = variations[0].preview || item.file_url;
                }
            } catch (e) { }
        }

        let colorDotsHtml = '';
        if (item.type === 'beautify' && variations.length > 0) {
            colorDotsHtml = '<div class="museum-color-dots">';
            variations.forEach((v, idx) => {
                const activeClass = idx === 0 ? 'active' : '';
                colorDotsHtml += `
                    <div class="color-dot ${activeClass}" data-idx="${idx}" title="${v.name || '样式'}" 
                         style="background-color: ${v.color || '#ccc'};">
                    </div>
                `;
            });
            colorDotsHtml += '</div>';
        }

        const cardHtml = `
            <div class="museum-item" data-id="${item.id}">
                <div class="museum-thumb-container">
                    <img class="museum-preview-img" src="${imgUrl}" loading="lazy">
                    <div class="museum-type-tag">${typeLabel}</div>
                </div>

                <div class="museum-info">
                    <div class="museum-title" title="${title}">${title}</div>
                    ${colorDotsHtml}
                    <div class="museum-selected-idx" data-idx="0"></div>
                    <div class="museum-action-btn import-btn">
                        <i class="fa-solid fa-download"></i> 导入
                    </div>
                </div>
            </div>
        `;
        
        const $card = $(cardHtml);

        if (item.type === 'beautify') {
            $card.find('.color-dot').on('click', function(e) {
                e.stopPropagation();
                const $this = $(this);
                const idx = $this.data('idx');
                const selectedVar = variations[idx];

                $card.find('.color-dot').css({'box-shadow': 'none', 'transform': 'none'});
                $this.css({
                    'box-shadow': '0 0 0 2px var(--SmartThemeBgColor), 0 0 0 4px var(--SmartThemeQuoteColor)',
                    'transform': 'scale(1.1)'
                });

                if (selectedVar && selectedVar.preview) {
                    const $img = $card.find('.museum-preview-img');
                    $img.css('opacity', 0.5);
                    $img.attr('src', selectedVar.preview);
                    $img.on('load', () => $img.css('opacity', 1));
                }
                $card.find('.museum-selected-idx').data('idx', idx);
            });
        }

        $card.find('.import-btn').on('click', () => handleImport(item, $card));
        grid.append($card);
    });
}

// --- 导入动作处理 ---

async function handleImport(item, $card) {
    if (item.type === 'role_card') {
        // 调用我们新写的角色卡导入逻辑
        await importRoleCard(item);
    } else if (item.type === 'beautify') {
        await importBeautifyDirectly(item, $card);
    }
}

// === 核心功能：角色卡导入逻辑（弹窗+时间轴） ===

async function importRoleCard(item) {
    // 1. 注入 CSS 样式（彻底修复移动端居中和图片显示）
    if (!$('#museum-role-styles').length) {
        $('head').append(`
            <style id="museum-role-styles">
                /* 遮罩层：居中对齐 */
                .museum-modal-overlay { 
                    position: fixed; 
                    top: 0; 
                    left: 0; 
                    width: 100%; 
                    height: 100%; 
                    background: rgba(0,0,0,0.8); 
                    backdrop-filter: blur(5px); 
                    z-index: 99999; 
                    display: flex; 
                    align-items: center; /* 确保垂直居中 */
                    justify-content: center; /* 确保水平居中 */
                    padding: 20px; 
                    box-sizing: border-box; 
                }

                /* 弹窗容器 */
                .museum-modal-content {
                    background: var(--SmartThemeBgColor, #1a1b26);
                    color: var(--SmartThemeBodyColor, #fff);
                    padding: 0;
                    border-radius: 12px;
                    width: 100%;
                    max-width: 600px;
                    max-height: 85vh; /* 严格限制最大高度，防止撑出屏幕 */
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    border: 1px solid var(--SmartThemeBorderColor, #333);
                    overflow: hidden; /* 保证圆角 */
                }

                /* 顶部标题栏 */
                .museum-modal-header {
                    padding: 15px;
                    background: rgba(0,0,0,0.2);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid var(--SmartThemeBorderColor, #333);
                    flex-shrink: 0; /* 禁止压缩 */
                }

                .museum-modal-title { font-weight: bold; font-size: 1.1em; }
                .museum-modal-close-icon { background: none; border: none; color: inherit; font-size: 1.5em; cursor: pointer; opacity: 0.7; padding: 0 10px;}

                /* 内容区域：允许滚动 */
                .museum-modal-body {
                    padding: 20px;
                    overflow-y: auto; /* 核心：内容过多时内部滚动 */
                    -webkit-overflow-scrolling: touch;
                    flex-grow: 1;
                }

                /* 角色布局容器：PC端左右结构 */
                .museum-role-layout {
                    display: flex;
                    gap: 20px;
                    margin-bottom: 20px;
                }

                /* 左侧图片容器 */
                .museum-role-img-container {
                    flex-shrink: 0;
                    width: 140px;
                }

                .museum-role-img {
                    width: 100%;
                    border-radius: 8px;
                    aspect-ratio: 2/3;
                    object-fit: cover;
                    border: 1px solid var(--SmartThemeBorderColor, #333);
                    display: block; /* 防止图片底部的留白 */
                }

                /* 右侧描述容器 */
                .museum-role-info {
                    flex-grow: 1;
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }

                .museum-role-desc { 
                    background: rgba(0,0,0,0.2); 
                    padding: 12px; 
                    border-radius: 8px; 
                    font-size: 0.9em; 
                    line-height: 1.5; 
                    max-height: 180px; 
                    overflow-y: auto; 
                    white-space: pre-wrap;
                    border-left: 3px solid var(--SmartThemeQuoteColor, #9abdf5);
                }

                /* 时间轴样式 */
                .museum-timeline {
                    position: relative;
                    padding-left: 20px;
                }
                .museum-timeline::before {
                    content: '';
                    position: absolute;
                    left: 7px;
                    top: 5px;
                    bottom: 5px;
                    width: 2px;
                    background: rgba(255,255,255,0.1);
                }
                .museum-timeline-item {
                    position: relative;
                    margin-bottom: 15px;
                    padding-bottom: 15px;
                    border-bottom: 1px solid rgba(255,255,255,0.05);
                }
                .museum-timeline-item:last-child { border: none; }
                .museum-timeline-dot {
                    position: absolute;
                    left: -17px;
                    top: 5px;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: var(--SmartThemeQuoteColor, #9abdf5);
                    box-shadow: 0 0 0 3px rgba(0,0,0,0.3);
                }
                .museum-timeline-item.latest .museum-timeline-dot {
                    background: #4caf50;
                }
                .museum-version-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 5px;
                    flex-wrap: wrap; 
                    gap: 5px;
                }
                .museum-version-date { font-weight: bold; font-size: 0.9em; }
                .museum-version-note { font-size: 0.85em; opacity: 0.7; margin-bottom: 8px; font-style: italic;}
                
                .museum-btn-sm {
                    padding: 4px 10px;
                    font-size: 0.8em;
                    border-radius: 4px;
                    border: 1px solid var(--SmartThemeBorderColor, #555);
                    background: transparent;
                    color: var(--SmartThemeBodyColor, #fff);
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                }
                .museum-btn-sm:hover {
                    background: var(--SmartThemeQuoteColor, #9abdf5);
                    color: #000;
                    border-color: var(--SmartThemeQuoteColor, #9abdf5);
                }

                /* === 移动端适配 === */
                @media (max-width: 768px) {
                    .museum-modal-content {
                        width: 95%; 
                        max-height: 85vh; /* 保证在手机屏幕内居中 */
                    }
                    
                    /* 布局改为上下结构 */
                    .museum-role-layout {
                        flex-direction: column;
                        align-items: center; /* 让图片水平居中 */
                        gap: 15px;
                        margin-bottom: 15px;
                    }

                    /* 手机端图片容器缩小，保持卡片比例 */
                    .museum-role-img-container {
                        width: 120px; /* 控制大小 */
                        height: auto;
                    }

                    /* 描述框调整 */
                    .museum-role-desc {
                        max-height: 120px; 
                        font-size: 0.85em;
                        width: 100%;
                        box-sizing: border-box;
                    }
                    
                    /* 标题缩号 */
                    .museum-modal-header {
                        padding: 10px 15px;
                    }
                    .museum-modal-title { font-size: 1em; }
                }
            </style>
        `);
    }

    // 2. 解析数据
    let data;
    try {
        data = JSON.parse(item.content);
    } catch (e) {
        data = { name: item.content, description: "暂无介绍", history: [] };
    }

    // 格式化历史记录
    let history = data.history || [];
    if (history.length === 0 && item.file_url) {
        history.push({
            date: item.created_at,
            png: item.file_url,
            note: "初始版本"
        });
    }

    const formatDate = (ts) => {
        if (!ts) return '未知时间';
        return new Date(ts).toLocaleString(undefined, {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute:'2-digit'
        });
    };

    // 3. 构建时间轴 HTML
    let timelineHtml = '';
    history.forEach((ver, idx) => {
        const isLatest = idx === 0 ? 'latest' : '';
        const label = idx === 0 ? '<span style="color:#4caf50; font-size:0.8em; margin-left:5px;">(NEW)</span>' : '';
        const note = ver.note ? ver.note : '无更新说明';
        
        const actionBtn = ver.png 
            ? `<button class="museum-btn-sm import-role-btn" data-url="${ver.png}" data-name="${data.name}">
                 <i class="fa-solid fa-download"></i> 导入
               </button>`
            : `<span style="font-size:0.8em; opacity:0.5;">文件丢失</span>`;

        timelineHtml += `
            <div class="museum-timeline-item ${isLatest}">
                <div class="museum-timeline-dot"></div>
                <div class="museum-version-header">
                    <div class="museum-version-date">${formatDate(ver.date)} ${label}</div>
                    ${actionBtn}
                </div>
                <div class="museum-version-note">${note}</div>
            </div>
        `;
    });

    // 4. 构建弹窗 HTML
    const modalHtml = `
    <div id="museum-role-modal" class="museum-modal-overlay">
        <div class="museum-modal-content">
            <div class="museum-modal-header">
                <div class="museum-modal-title"><i class="fa-solid fa-user-tag"></i> ${data.name || '角色详情'}</div>
                <button class="museum-modal-close-icon" id="museum-role-close">&times;</button>
            </div>
            
            <div class="museum-modal-body custom-scroll">
                <div class="museum-role-layout">
                    <!-- 图片容器 -->
                    <div class="museum-role-img-container">
                        <img src="${item.file_url}" class="museum-role-img">
                    </div>
                    <!-- 描述容器 -->
                    <div class="museum-role-info">
                        <div style="font-size:0.8em; opacity:0.7; margin-bottom:5px;">角色介绍:</div>
                        <div class="museum-role-desc custom-scroll">${data.description || '暂无介绍'}</div>
                    </div>
                </div>

                <div style="font-size:0.8em; opacity:0.7; margin-bottom:10px; border-top:1px solid rgba(255,255,255,0.1); padding-top:10px;">
                    版本历史:
                </div>
                
                <div class="museum-timeline">
                    ${timelineHtml}
                </div>
            </div>
        </div>
    </div>
    `;

    // 5. 显示弹窗
    $('#museum-role-modal').remove();
    $('body').append(modalHtml);

    // 6. 绑定关闭事件
    const closeModal = () => $('#museum-role-modal').remove();
    $('#museum-role-close').on('click', closeModal);
    
    // 点击遮罩层空白处关闭
    $('.museum-modal-overlay').on('click', function(e) {
        if ($(e.target).hasClass('museum-modal-overlay')) {
            closeModal();
        }
    });

    // 7. 绑定“导入”按钮点击事件
    $('.import-role-btn').on('click', async function() {
        const url = $(this).data('url');
        const name = $(this).data('name');
        const btn = $(this);
        const originalText = btn.html();

        btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');
        
        await performCharacterImport(url, name);
        
        btn.html('<i class="fa-solid fa-check"></i>');
        setTimeout(() => btn.html(originalText), 2000);
    });
}


// 模拟 ST 原生导入逻辑
async function performCharacterImport(url, charName) {
    try {
        if (!url) throw new Error("无效的文件链接");

        // 1. 下载图片 Blob
        const res = await fetch(url);
        if (!res.ok) throw new Error(`下载失败: ${res.status}`);
        const blob = await res.blob();

        // 2. 构造 File 对象
        let ext = 'png';
        if (blob.type.includes('json') || url.endsWith('.json')) ext = 'json';
        
        const cleanName = (charName || 'character').replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g, '_');
        const filename = `${cleanName}.${ext}`;
        const file = new File([blob], filename, { type: blob.type });

        // 3. 寻找 SillyTavern 的导入输入框
        const stImportInput = document.getElementById('character_import_file');
        
        if (!stImportInput) {
            throw new Error("找不到 SillyTavern 的角色导入组件 (#character_import_file)");
        }

        // 4. 利用 DataTransfer 将 File 对象塞进 input
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        stImportInput.files = dataTransfer.files;

        // 5. 触发 change 事件
        const changeEvent = new Event('change', { bubbles: true });
        stImportInput.dispatchEvent(changeEvent);

        toast.success(`正在导入角色: ${charName}`);

    } catch (e) {
        console.error(e);
        toast.error(`导入失败: ${e.message}`);
    }
}

// 美化主题导入
async function importBeautifyDirectly(item, $card) {
    const btn = $card.find('.import-btn');
    const originalText = btn.html();
    
    try {
        const selectedIdx = $card.find('.museum-selected-idx').data('idx') || 0;
        const json = JSON.parse(item.content);
        const variations = json.variations || [];
        const selectedVar = variations[selectedIdx];

        if (!selectedVar || !selectedVar.file) {
            throw new Error("此配色方案没有有效的源文件链接");
        }

        const themeUrl = selectedVar.file;
        const themeName = selectedVar.name || json.title || "自定义主题";

        btn.html('<i class="fa-solid fa-spinner fa-spin"></i> 下载中...');

        const response = await fetch(themeUrl);
        if (!response.ok) throw new Error(`网络请求失败: ${response.status}`);
        
        const blob = await response.blob();
        const fileName = `${themeName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.json`;
        const file = new File([blob], fileName, { type: "application/json" });

        btn.html('<i class="fa-solid fa-spinner fa-spin"></i> 导入中...');

        const stThemeInput = document.getElementById('ui_preset_import_file');
        if (!stThemeInput) throw new Error("找不到 ST 主题导入组件");

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        stThemeInput.files = dataTransfer.files;

        const changeEvent = new Event('change', { bubbles: true });
        stThemeInput.dispatchEvent(changeEvent);

        toast.success(`主题 "${themeName}" 已成功导入！`);
        
        setTimeout(() => {
            btn.html('<i class="fa-solid fa-check"></i> 成功');
            setTimeout(() => btn.html(originalText), 2000);
        }, 500);

    } catch (e) {
        console.error(e);
        toast.error("主题导入失败: " + e.message);
        btn.html(originalText);
    }
}

// --- 界面创建 ---

function createSettingsHtml() {
    const settings = getExtensionSettings()[EXTENSION_NAME] || {};
    
    return `
    <div id="${EXTENSION_ID}" class="inline-drawer wide100p flexFlowColumn">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-building-columns"></i> 博物馆 (Museum)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>

        <div class="inline-drawer-content museum-drawer-content">
            <div class="flex-container">
                <div class="menu_button fa-solid fa-arrows-rotate" id="museum-refresh-btn" title="刷新"></div>
                <div class="menu_button fa-solid fa-gear" id="museum-config-toggle" title="设置"></div>
            </div>

            <div id="museum-auth-panel" class="museum-auth-box" style="display:none;">
                <small>Supabase 连接配置</small>
                <input type="text" id="museum-sb-url" class="text_pole textarea_compact" placeholder="Supabase URL" value="${settings.sbUrl || ''}">
                <input type="password" id="museum-sb-key" class="text_pole textarea_compact" placeholder="Supabase Key" value="${settings.sbKey || ''}">
                <input type="text" id="museum-email" class="text_pole textarea_compact" placeholder="Email" value="${settings.sbEmail || ''}">
                <input type="password" id="museum-pass" class="text_pole textarea_compact" placeholder="Password" value="${settings.sbPass || ''}">
                <button id="museum-save-btn" class="menu_button" style="width:100%; margin-top:5px;">保存并登录</button>
            </div>

            <div class="museum-filter-bar">
                <div class="museum-filter-btn active" data-filter="all">全部</div>
                <div class="museum-filter-btn" data-filter="role_card">角色</div>
                <div class="museum-filter-btn" data-filter="beautify">美化</div>
            </div>

            <div id="museum-grid" class="museum-grid">
                <div style="grid-column:1/-1; text-align:center; padding:20px; opacity:0.5; font-size:0.8em;">
                    点击上方刷新按钮加载内容
                </div>
            </div>
        </div>
    </div>
    `;
}

// --- 初始化逻辑 ---

function initializePlugin() {
    console.log("[Museum] 初始化...");

    const settings = getExtensionSettings();
    if (settings && !settings[EXTENSION_NAME]) {
        settings[EXTENSION_NAME] = { sbUrl: "", sbKey: "", sbEmail: "", sbPass: "" };
        saveExtensionSettings();
    }

    const targetContainer = document.getElementById('extensions_settings');
    const secondaryContainer = document.getElementById('extensions_settings2');
    
    if (document.getElementById(EXTENSION_ID)) return;

    const html = createSettingsHtml();
    
    if (secondaryContainer) {
        secondaryContainer.insertAdjacentHTML('beforeend', html);
    } else if (targetContainer) {
        targetContainer.insertAdjacentHTML('beforeend', html);
    } else {
        console.error("[Museum] 找不到扩展面板容器 (#extensions_settings)");
    }

    // 绑定事件
    $('#museum-config-toggle').on('click', () => $('#museum-auth-panel').slideToggle());
    
    $('#museum-save-btn').on('click', async () => {
        const extSettings = getExtensionSettings()[EXTENSION_NAME];
        extSettings.sbUrl = $('#museum-sb-url').val().trim();
        extSettings.sbKey = $('#museum-sb-key').val().trim();
        extSettings.sbEmail = $('#museum-email').val().trim();
        extSettings.sbPass = $('#museum-pass').val().trim();
        
        saveExtensionSettings();
        
        const success = await initSupabaseClient();
        if (success) {
            $('#museum-auth-panel').slideUp();
            refreshGallery();
        }
    });

    $('.museum-filter-btn').on('click', function() {
        $('.museum-filter-btn').removeClass('active');
        $(this).addClass('active');
        currentFilter = $(this).data('filter');
        refreshGallery();
    });

    $('#museum-refresh-btn').on('click', refreshGallery);

    loadSupabase().then(() => {
        const s = getExtensionSettings()[EXTENSION_NAME];
        if (s && s.sbUrl && s.sbKey) {
            initSupabaseClient().then(() => {
                if (session) refreshGallery();
            });
        }
    });

    console.log("[Museum] 初始化完成");
}

// --- 启动器 ---
(function () {
    const waitForSillyTavernContext = () => {
        const context = getContext();
        if (context && context.eventSource && context.eventTypes) {
            context.eventSource.once(context.eventTypes.APP_READY, () => {
                setTimeout(initializePlugin, 500);
            });
        } else {
            setTimeout(waitForSillyTavernContext, 100);
        }
    };

    waitForSillyTavernContext();
})();
