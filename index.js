// 扩展名称和常量
const EXTENSION_NAME = "museum_importer";
const EXTENSION_ID = "museum-extension-root"; // 唯一的 DOM ID

// 全局变量
let supabase = null;
let session = null;
let currentFilter = 'all';
let keepAliveTimer = null; 
// --- 核心工具函数 ---

// 获取 ST 上下文
const getContext = () => {
    return window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : null;
}

// 获取扩展设置
function getExtensionSettings() {
    const context = getContext();
    if (context && context.extensionSettings) {
        return context.extensionSettings;
    }
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

// --- 样式注入 (修复图片高度自适应) ---
function injectStyles() {
    if ($('#museum-extension-styles').length) return;

    const css = `
        /* === 网格布局 === */
        .museum-grid {
            display: grid;
            gap: 12px;
            padding: 10px 0;
            width: 100%;
            /* 移动端默认: 3 列 */
            grid-template-columns: repeat(3, 1fr);
            /* 【核心修改】顶部对齐，允许卡片高度不一致（瀑布流效果取决于列宽，非真正瀑布流但不再拉伸） */
            align-items: start;
        }

        /* PC端 (宽度大于800px): 2 列 */
        @media (min-width: 800px) {
            .museum-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        /* === 卡片基础样式 === */
        .museum-item {
            background-color: var(--SmartThemeBgColor);
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 8px;
            overflow: hidden;
            position: relative; 
            display: flex;
            flex-direction: column;
            transition: all 0.2s ease;
            /* 【核心修改】高度完全自适应内容 */
            height: auto; 
            box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        
        .museum-item:hover {
            border-color: var(--SmartThemeQuoteColor);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }

        /* === 图片容器 === */
        .museum-thumb-container {
            width: 100%;
            /* 【核心修改】移除 aspect-ratio 和固定高度 */
            height: auto; 
            flex-shrink: 0;
            background-color: rgba(0,0,0,0.05);
            position: relative;
            overflow: hidden;
            border-bottom: 1px solid var(--SmartThemeBorderColor);
            /* 消除图片底部的微小空隙 */
            display: flex; 
        }

        .museum-preview-img {
            width: 100%;
            /* 【核心修改】高度自动，保持原图比例 */
            height: auto; 
            display: block;
            transition: transform 0.5s ease;
        }
        
        .museum-item:hover .museum-preview-img {
            transform: scale(1.05); 
        }

        .museum-type-tag {
            position: absolute;
            top: 6px;
            right: 6px;
            background: rgba(0,0,0,0.6);
            color: #fff;
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            backdrop-filter: blur(2px);
            z-index: 2;
            pointer-events: none;
        }

        /* === 底部信息区 === */
        .museum-info {
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            background-color: var(--SmartThemeBgColor);
            z-index: 2;
            /* 移除 flex-grow，让其紧贴图片下方 */
        }

        .museum-title {
            font-size: 0.95em;
            font-weight: bold;
            color: var(--SmartThemeBodyColor);
            /* 允许标题换行，防止撑破布局 */
            white-space: normal;
            word-break: break-all;
            line-height: 1.3;
        }

        /* 按钮组 */
        .museum-btn-group {
            display: flex;
            gap: 6px;
            margin-top: 5px;
        }

        .museum-action-btn {
            background-color: var(--SmartThemeQuoteColor);
            color: var(--SmartThemeBodyColor);
            text-align: center;
            padding: 6px 0;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            flex: 1;
            transition: opacity 0.2s;
            border: 1px solid transparent;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            font-weight: 500;
        }
        .museum-action-btn:hover {
            opacity: 0.85;
            filter: brightness(1.1);
        }
        
        .museum-action-btn.secondary {
            background-color: transparent;
            border: 1px solid var(--SmartThemeBorderColor);
            color: var(--SmartThemeBodyColor);
            flex: 0 0 32px; /* 方形按钮 */
        }
        .museum-action-btn.secondary:hover {
            border-color: var(--SmartThemeQuoteColor);
            color: var(--SmartThemeQuoteColor);
            background-color: rgba(128,128,128,0.05);
        }

        /* === 内部覆盖层 (详情/历史) === */
        /* 修改覆盖层逻辑：因为父容器高度不固定，绝对定位可能会溢出或不足 */
        /* 但为了覆盖效果，我们仍保持 absolute full size */
        .museum-card-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: var(--SmartThemeBgColor);
            z-index: 10;
            display: flex;
            flex-direction: column;
            transform: translateY(100%);
            transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
            padding: 0;
            box-sizing: border-box;
        }
        .museum-card-overlay.active {
            transform: translateY(0);
        }

        /* 覆盖层头部 */
        .museum-overlay-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            border-bottom: 1px solid var(--SmartThemeBorderColor);
            background-color: rgba(0,0,0,0.03);
            flex-shrink: 0;
        }
        .museum-overlay-title {
            font-size: 0.9em;
            font-weight: bold;
            color: var(--SmartThemeBodyColor);
        }
        .museum-overlay-close {
            cursor: pointer;
            padding: 4px;
            opacity: 0.6;
            transition: opacity 0.2s;
        }
        .museum-overlay-close:hover { opacity: 1; color: var(--SmartThemeQuoteColor); }

        /* 覆盖层内容滚动区 */
        .museum-overlay-body {
            flex-grow: 1;
            overflow-y: auto;
            padding: 12px;
            font-size: 0.85em;
            color: var(--SmartThemeBodyColor);
            scrollbar-width: thin;
            scrollbar-color: var(--SmartThemeQuoteColor) transparent;
        }
        .museum-overlay-body::-webkit-scrollbar { width: 4px; }
        .museum-overlay-body::-webkit-scrollbar-thumb { background: var(--SmartThemeQuoteColor); border-radius: 2px; }

        /* 角色简介 */
        .museum-role-desc {
            margin-bottom: 15px;
            line-height: 1.5;
            opacity: 0.9;
            white-space: pre-wrap;
            padding-bottom: 10px;
            border-bottom: 1px dashed var(--SmartThemeBorderColor);
        }

        /* 迷你时间轴列表 */
        .museum-mini-timeline {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .timeline-label {
            font-size: 0.8em;
            opacity: 0.6;
            margin-bottom: 5px;
            font-weight: bold;
            text-transform: uppercase;
        }

        .museum-version-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px;
            background: rgba(128,128,128,0.05);
            border-radius: 6px;
            border: 1px solid var(--SmartThemeBorderColor);
            transition: background 0.2s;
        }
        .museum-version-row:hover {
            background: rgba(128,128,128,0.1);
        }
        
        .museum-version-info {
            display: flex;
            flex-direction: column;
            overflow: hidden;
            margin-right: 5px;
        }
        .museum-v-date { 
            font-weight: bold; 
            font-size: 0.9em; 
            color: var(--SmartThemeBodyColor);
        }
        .museum-v-note { 
            font-size: 0.8em; 
            opacity: 0.7; 
            white-space: nowrap; 
            overflow: hidden; 
            text-overflow: ellipsis; 
            max-width: 100%;
        }
        
        .museum-v-btn {
            font-size: 0.8em;
            padding: 4px 10px;
            background: var(--SmartThemeBgColor);
            border: 1px solid var(--SmartThemeBorderColor);
            color: var(--SmartThemeBodyColor);
            border-radius: 4px;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s;
        }
        .museum-v-btn:hover {
            background: var(--SmartThemeQuoteColor);
            border-color: var(--SmartThemeQuoteColor);
            color: var(--SmartThemeBodyColor); 
        }

        /* 美化颜色点 */
        .museum-color-dots {
            display: flex;
            gap: 5px;
            overflow-x: auto;
            padding-bottom: 4px;
            margin-bottom: 2px;
        }
        .color-dot {
            width: 14px;
            height: 14px;
            border-radius: 50%;
            border: 1px solid rgba(128,128,128,0.3);
            cursor: pointer;
            flex-shrink: 0;
            transition: transform 0.2s;
        }
        .color-dot:hover {
            transform: scale(1.2);
        }
        
        /* 旋转动画 */
        .fa-spin { animation: fa-spin 2s infinite linear; }
        @keyframes fa-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    `;
    $('head').append(`<style id="museum-extension-styles">${css}</style>`);
}
async function keepAliveSupabase() {
    if (!supabase) return;
    try {
        // 请求最少的数据，只查 1 条数据的 ID，极低消耗
        await supabase.from("fragments").select("id").limit(1);
        console.log("[Museum] Supabase 后台保活请求已发送，防止账号被暂停");
    } catch (e) {
        console.warn("[Museum] Supabase 保活请求失败:", e.message);
    }
}

function startKeepAlive() {
    // 如果已经有定时器，先清除，防止重复
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    
    // 设置定时器，每 12 小时执行一次保活请求 (12小时 * 60分 * 60秒 * 1000毫秒)
    keepAliveTimer = setInterval(() => {
        keepAliveSupabase();
    }, 12 * 60 * 60 * 1000);
    
    console.log("[Museum] Supabase 保活机制已启动 (每12小时一次)");
}

// --- Supabase 逻辑 (保持不变) ---
async function loadSupabase() {
    if (window.supabase) return;
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
            script.onload = () => resolve();
            script.onerror = () => { document.head.removeChild(script); reject(); };
            document.head.appendChild(script);
        });
    };
    for (const url of sources) {
        try { await tryLoadScript(url); return; } catch (e) { continue; }
    }
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
            startKeepAlive(); // 【新增】连接成功，启动保活
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
        
        startKeepAlive(); // 【新增】登录成功，启动保活
        
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

// 格式化时间辅助函数
const formatDateShort = (ts) => {
    if (!ts) return '未知';
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
};

function renderItems(items) {
    const grid = $('#museum-grid');
    grid.empty();

    if (items.length === 0) {
        grid.html('<div style="text-align:center; padding:20px; opacity: 0.7; color: var(--SmartThemeBodyColor);">暂无内容</div>');
        return;
    }

    items.forEach(item => {
        // --- 数据解析 ---
        let title = "未命名";
        let typeLabel = "未知";
        let imgUrl = "";
        let variations = [];
        let description = "";
        let history = [];
        
        if (item.type === 'role_card') {
            typeLabel = "角色";
            try {
                if (item.content.startsWith('{')) {
                    const json = JSON.parse(item.content);
                    title = json.name || "未命名";
                    description = json.description || "暂无简介";
                    history = json.history || [];
                    
                    // 如果历史记录为空但有 file_url，构造初始记录
                    if (history.length === 0 && item.file_url) {
                        history.push({
                            date: item.created_at,
                            png: item.file_url,
                            note: "初始版本"
                        });
                    }
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

        // --- 构建 HTML ---

        // 1. 卡片主体
        let colorDotsHtml = '';
        if (item.type === 'beautify' && variations.length > 0) {
            colorDotsHtml = '<div class="museum-color-dots">';
            variations.forEach((v, idx) => {
                colorDotsHtml += `<div class="color-dot" data-idx="${idx}" title="${v.name}" style="background-color: ${v.color};"></div>`;
            });
            colorDotsHtml += '</div>';
        }

        // 角色卡的“详情”按钮
        const detailBtn = item.type === 'role_card' 
            ? `<div class="museum-action-btn secondary toggle-overlay-btn" title="查看详情与历史版本"><i class="fa-solid fa-list-ul"></i></div>` 
            : '';

        const cardHtml = `
            <div class="museum-item" data-id="${item.id}">
                <!-- 正面内容 -->
                <div class="museum-thumb-container">
                    <img class="museum-preview-img" src="${imgUrl}" loading="lazy">
                    <div class="museum-type-tag">${typeLabel}</div>
                </div>

                <div class="museum-info">
                    <div class="museum-title" title="${title}">${title}</div>
                    ${colorDotsHtml}
                    <div class="museum-selected-idx" data-idx="0"></div>
                    
                    <div class="museum-btn-group">
                        <div class="museum-action-btn import-btn">
                            <i class="fa-solid fa-download"></i> 导入
                        </div>
                        ${detailBtn}
                    </div>
                </div>

                <!-- 内部覆盖层 (角色卡专用) -->
                ${item.type === 'role_card' ? `
                <div class="museum-card-overlay">
                    <div class="museum-overlay-header">
                        <span class="museum-overlay-title"><i class="fa-solid fa-clock-rotate-left"></i> 档案记录</span>
                        <div class="museum-overlay-close toggle-overlay-btn"><i class="fa-solid fa-xmark"></i></div>
                    </div>
                    <div class="museum-overlay-body">
                        <div class="museum-role-desc">${description}</div>
                        
                        <div class="timeline-label">历史版本</div>
                        <div class="museum-mini-timeline"></div>
                    </div>
                </div>` : ''}
            </div>
        `;
        
        const $card = $(cardHtml);

        // --- 事件绑定 ---

        // 1. 美化包颜色切换
        if (item.type === 'beautify') {
            $card.find('.color-dot').on('click', function(e) {
                e.stopPropagation();
                const idx = $(this).data('idx');
                const selectedVar = variations[idx];
                $card.find('.color-dot').css({'border-color': 'rgba(128,128,128,0.3)', 'transform': 'scale(1)'});
                $(this).css({'border-color': 'var(--SmartThemeQuoteColor)', 'transform': 'scale(1.2)'});
                
                if (selectedVar && selectedVar.preview) {
                    $card.find('.museum-preview-img').attr('src', selectedVar.preview);
                }
                $card.find('.museum-selected-idx').data('idx', idx);
            });
        }

        // 2. 角色卡覆盖层切换
        if (item.type === 'role_card') {
            const overlay = $card.find('.museum-card-overlay');
            const timelineContainer = overlay.find('.museum-mini-timeline');

            // 渲染历史列表
            history.forEach((ver, idx) => {
                const isLatest = idx === 0;
                const rowHtml = `
                    <div class="museum-version-row">
                        <div class="museum-version-info">
                            <span class="museum-v-date">${formatDateShort(ver.date)} ${isLatest ? '<span style="color:#4caf50; font-size:0.8em; margin-left:4px;">NEW</span>' : ''}</span>
                            <span class="museum-v-note" title="${ver.note || ''}">${ver.note || '无说明'}</span>
                        </div>
                        <button class="museum-v-btn history-import-btn" data-url="${ver.png || ver.json}">
                            导入
                        </button>
                    </div>
                `;
                timelineContainer.append(rowHtml);
            });

            // 详情按钮开关
            $card.find('.toggle-overlay-btn').on('click', function(e) {
                e.stopPropagation();
                overlay.toggleClass('active');
            });

            // 历史记录导入按钮
            $card.find('.history-import-btn').on('click', function(e) {
                e.stopPropagation();
                const url = $(this).data('url');
                const btn = $(this);
                handleHistoryImport(url, title, btn);
            });
        }

        // 3. 主导入按钮 (导入最新/默认)
        $card.find('.import-btn').on('click', function(e) {
            e.stopPropagation(); 
            handleImport(item, $card);
        });
        
        grid.append($card);
    });
}

// --- 导入逻辑 ---

async function handleImport(item, $card) {
    if (item.type === 'role_card') {
        const btn = $card.find('.import-btn');
        const originalHtml = btn.html();
        btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');
        
        try {
            // 解析获取最新名字
            let charName = "character";
            try {
                const json = JSON.parse(item.content);
                if (json.name) charName = json.name;
            } catch(e) {}

            await performCharacterImport(item.file_url, charName);
            btn.html('<i class="fa-solid fa-check"></i>');
        } catch (e) {
            btn.html('<i class="fa-solid fa-xmark"></i>');
        }
        setTimeout(() => btn.html(originalHtml), 2000);

    } else if (item.type === 'beautify') {
        await importBeautifyDirectly(item, $card);
    }
}

// 历史版本导入
async function handleHistoryImport(url, charName, $btn) {
    const originalText = $btn.text();
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');
    
    try {
        await performCharacterImport(url, charName);
        $btn.html('<i class="fa-solid fa-check"></i>');
    } catch (e) {
        $btn.html('<i class="fa-solid fa-xmark"></i>');
    }
    setTimeout(() => $btn.text(originalText), 2000);
}

// 核心 ST 导入逻辑
async function performCharacterImport(url, charName) {
    try {
        if (!url) throw new Error("无效的文件链接");

        const res = await fetch(url);
        if (!res.ok) throw new Error(`下载失败: ${res.status}`);
        const blob = await res.blob();

        let ext = 'png';
        if (blob.type.includes('json') || url.endsWith('.json')) ext = 'json';
        
        const cleanName = (charName || 'character').replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g, '_');
        const filename = `${cleanName}.${ext}`;
        const file = new File([blob], filename, { type: blob.type });

        const stImportInput = document.getElementById('character_import_file');
        
        if (!stImportInput) throw new Error("找不到角色导入组件");

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        stImportInput.files = dataTransfer.files;

        const changeEvent = new Event('change', { bubbles: true });
        stImportInput.dispatchEvent(changeEvent);

        toast.success(`正在导入: ${charName}`);

    } catch (e) {
        console.error(e);
        toast.error(`导入失败: ${e.message}`);
        throw e;
    }
}

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

        btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');

        const response = await fetch(themeUrl);
        if (!response.ok) throw new Error(`网络请求失败`);
        
        const blob = await response.blob();
        const fileName = `${themeName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.json`;
        const file = new File([blob], fileName, { type: "application/json" });

        const stThemeInput = document.getElementById('ui_preset_import_file');
        if (!stThemeInput) throw new Error("找不到 ST 主题导入组件");

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        stThemeInput.files = dataTransfer.files;

        const changeEvent = new Event('change', { bubbles: true });
        stThemeInput.dispatchEvent(changeEvent);

        toast.success(`主题 "${themeName}" 已导入`);
        btn.html('<i class="fa-solid fa-check"></i>');
        
    } catch (e) {
        console.error(e);
        toast.error("导入失败: " + e.message);
        btn.html('<i class="fa-solid fa-xmark"></i>');
    }
    setTimeout(() => btn.html(originalText), 2000);
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

    // 注入 CSS 样式
    injectStyles();

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
