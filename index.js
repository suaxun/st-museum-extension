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

// --- Supabase 逻辑 (保持不变，因为这部分没问题) ---
// 增强版加载函数：自动重试多个源
async function loadSupabase() {
    if (window.supabase) return;
    
    // 备选 CDN 列表 (优先尝试 unpkg，然后是 cloudflare，最后 jsdelivr)
    const sources = [
        "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js",
        "https://cdnjs.cloudflare.com/ajax/libs/supabase.js/2.39.7/supabase.min.js",
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.8/dist/umd/supabase.min.js"
    ];

    console.log("[Museum] 正在加载 Supabase SDK...");

    // 辅助函数：尝试加载单个脚本
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
                document.head.removeChild(script); // 失败移除
                reject();
            };
            document.head.appendChild(script);
        });
    };

    // 顺序尝试列表中的 URL
    for (const url of sources) {
        try {
            await tryLoadScript(url);
            return; // 加载成功，直接返回
        } catch (e) {
            // 当前 URL 失败，继续尝试下一个
            continue;
        }
    }

    // 如果所有都失败了
    const errorMsg = "[Museum] 错误：所有 CDN 源均无法连接，请检查网络代理或将 supabase.js 下载到本地。";
    console.error(errorMsg);
    if (window.toastr) window.toastr.error("无法加载 Supabase 组件，请检查控制台 (F12)");
    throw new Error(errorMsg);
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

// --- 数据获取与渲染 (保持不变) ---

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
        grid.html('<div style="text-align:center; padding:20px;">暂无内容</div>');
        return;
    }

    items.forEach(item => {
        let title = "未命名";
        let typeLabel = "未知";
        let imgUrl = "";
        
        if (item.type === 'role_card') {
            typeLabel = "角色";
            try {
                if (item.content.startsWith('{')) {
                    const json = JSON.parse(item.content);
                    title = json.name;
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
                if (json.variations && json.variations[0]) {
                    imgUrl = json.variations[0].preview;
                }
            } catch (e) { }
        }

        const cardHtml = `
            <div class="museum-item" data-id="${item.id}">
                <div style="width:100%; aspect-ratio:2/3; background:#222; overflow:hidden; display:flex; align-items:center; justify-content:center;">
                    <img src="${imgUrl}" style="width:100%; height:100%; object-fit:cover; transition: transform 0.3s;" loading="lazy">
                </div>
                <div class="museum-info">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="museum-type-tag">${typeLabel}</span>
                    </div>
                    <div class="museum-title" title="${title}">${title}</div>
                    <div class="museum-action-btn import-btn">
                        <i class="fa-solid fa-download"></i> 导入
                    </div>
                </div>
            </div>
        `;
        
        const $card = $(cardHtml);
        $card.find('.import-btn').on('click', () => handleImport(item));
        grid.append($card);
    });
}

// --- 导入动作处理 ---

async function handleImport(item) {
    if (item.type === 'role_card') {
        await importRoleCard(item);
    } else if (item.type === 'beautify') {
        // 调用新的美化导入逻辑
        await importBeautifySmart(item);
    }
}

// 智能美化导入：处理多变体
async function importBeautifySmart(item) {
    const btn = $(`div[data-id="${item.id}"] .import-btn`);
    const originalText = btn.html();
    
    try {
        // 1. 解析 JSON 内容
        let variations = [];
        let title = "未知主题";
        try {
            const json = JSON.parse(item.content);
            title = json.title || title;
            variations = json.variations || [];
        } catch (e) {
            console.error("JSON 解析失败", e);
            throw new Error("数据格式错误");
        }

        if (!variations || variations.length === 0) {
            throw new Error("该主题没有包含任何配色方案");
        }

        // 修改：无论数量多少，统一通过弹窗展示，方便用户预览
        showVariationModal(title, variations);

    } catch (e) {
        toast.error("准备导入失败: " + e.message);
    } 
    // 注意：如果是弹窗模式，这里不需要 finally 恢复文字，因为弹窗是异步的
}


// 显示选择弹窗 (增强版：带预览)
function showVariationModal(title, variations) {
    // 移除旧弹窗（防止重复）
    $('#museum-variation-modal').remove();

    // 默认选中第一个
    let selectedIndex = 0;

    // 构建变体按钮 HTML
    let buttonsHtml = '';
    variations.forEach((v, index) => {
        const name = v.name || `样式 ${index + 1}`;
        const activeClass = index === 0 ? 'active' : '';
        // 使用 color 属性来设置小圆点颜色，如果没有则用灰色
        const colorStyle = v.color ? `background-color:${v.color};` : `background-color:#ccc;`;
        
        buttonsHtml += `
            <div class="museum-variation-chip ${activeClass}" data-index="${index}">
                <span class="museum-chip-color" style="${colorStyle}"></span>
                <span class="museum-chip-text">${name}</span>
            </div>
        `;
    });

    // 获取当前预览图
    const currentPreview = variations[0].preview || '';

    const modalHtml = `
    <div id="museum-variation-modal" class="museum-modal-overlay">
        <div class="museum-modal-content" style="max-width: 400px;">
            <div class="museum-modal-header">
                <div class="museum-modal-title">导入主题: ${title}</div>
                <button class="museum-modal-close-icon" id="museum-modal-cancel-icon">&times;</button>
            </div>
            
            <!-- 预览图区域 -->
            <div class="museum-preview-container">
                <img id="museum-modal-preview-img" src="${currentPreview}" class="museum-preview-img" alt="预览图加载失败">
                <div class="museum-preview-loading" style="display:none;">加载中...</div>
            </div>

            <div style="margin:15px 0 5px; font-size:0.8em; opacity:0.7;">选择配色方案:</div>
            
            <!-- 选项列表 -->
            <div class="museum-variation-chips-container">
                ${buttonsHtml}
            </div>

            <div class="museum-modal-footer">
                <button class="museum-btn-secondary" id="museum-modal-cancel">取消</button>
                <button class="museum-btn-primary" id="museum-modal-confirm">导入选中样式</button>
            </div>
        </div>
    </div>
    `;

    // 插入 DOM
    $('body').append(modalHtml);

    // 注入临时样式 (为了保证弹窗好看，直接在这里补样式，也可以写在 CSS 文件里)
    if (!$('#museum-modal-styles').length) {
        $('head').append(`
            <style id="museum-modal-styles">
                .museum-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; bg: rgba(0,0,0,0.7); backdrop-filter: blur(5px); z-index: 9999; display: flex; align-items: center; justify-content: center; }
                .museum-modal-content { background: var(--SmartThemeBgColor, #1a1b26); color: var(--SmartThemeBodyColor, #fff); padding: 20px; border-radius: 12px; width: 90%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid var(--SmartThemeBorderColor, #333); display: flex; flex-direction: column; }
                .museum-modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
                .museum-modal-title { font-weight: bold; font-size: 1.1em; }
                .museum-modal-close-icon { background: none; border: none; color: inherit; font-size: 1.5em; cursor: pointer; opacity: 0.7; }
                
                .museum-preview-container { width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 8px; overflow: hidden; position: relative; border: 1px solid var(--SmartThemeBorderColor, #333); }
                .museum-preview-img { width: 100%; height: 100%; object-fit: cover; transition: opacity 0.3s; }
                
                .museum-variation-chips-container { display: flex; flex-wrap: wrap; gap: 8px; max-height: 150px; overflow-y: auto; margin-bottom: 20px; }
                .museum-variation-chip { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(255,255,255,0.05); border: 1px solid transparent; border-radius: 20px; cursor: pointer; transition: all 0.2s; font-size: 0.9em; }
                .museum-variation-chip:hover { background: rgba(255,255,255,0.1); }
                .museum-variation-chip.active { background: rgba(255,255,255,0.15); border-color: var(--SmartThemeQuoteColor, #9abdf5); box-shadow: 0 0 10px rgba(0,0,0,0.2); }
                .museum-chip-color { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); }
                
                .museum-modal-footer { display: flex; justify-content: flex-end; gap: 10px; }
                .museum-btn-primary { background: var(--SmartThemeQuoteColor, #9abdf5); color: #000; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; }
                .museum-btn-secondary { background: transparent; color: inherit; border: 1px solid var(--SmartThemeBorderColor, #555); padding: 8px 16px; border-radius: 6px; cursor: pointer; }
                .museum-btn-primary:hover { opacity: 0.9; }
                .museum-btn-secondary:hover { background: rgba(255,255,255,0.05); }
            </style>
        `);
    }

    // --- 绑定事件 ---

    // 1. 点击选项切换预览
    $('.museum-variation-chip').on('click', function() {
        const index = $(this).data('index');
        
        // 只有切换时才更新
        if (selectedIndex === index) return;
        
        selectedIndex = index;
        
        // 更新 UI 状态
        $('.museum-variation-chip').removeClass('active');
        $(this).addClass('active');
        
        // 更新预览图
        const newPreview = variations[index].preview;
        if (newPreview) {
            const img = $('#museum-modal-preview-img');
            img.css('opacity', 0.5); // 简单的淡出效果
            img.attr('src', newPreview);
            img.on('load', () => img.css('opacity', 1));
        }
    });

    // 2. 确认导入
    $('#museum-modal-confirm').on('click', async function() {
        const selectedVar = variations[selectedIndex];
        if (!selectedVar) return;

        const url = selectedVar.file;
        const name = selectedVar.name || `样式 ${selectedIndex + 1}`;

        // 关闭弹窗
        $('#museum-variation-modal').remove();

        // 执行导入
        toast.info(`正在下载主题: ${name}...`);
        await applyThemeUrl(url, name);
    });

    // 3. 关闭逻辑
    const closeModal = () => $('#museum-variation-modal').remove();
    $('#museum-modal-cancel').on('click', closeModal);
    $('#museum-modal-cancel-icon').on('click', closeModal);
    $('#museum-variation-modal').on('click', (e) => {
        if (e.target.id === 'museum-variation-modal') closeModal();
    });
}


// 执行具体的 CSS 下载与应用
async function applyThemeUrl(cssUrl, themeName) {
    try {
        if (!cssUrl) throw new Error("CSS 链接无效");

        // 使用 fetch 获取 CSS 文本
        const res = await fetch(cssUrl);
        if (!res.ok) throw new Error(`下载失败: ${res.status}`);
        const cssText = await res.text();

        if (!cssText || cssText.trim().length === 0) throw new Error("CSS 内容为空");

        // 寻找 SillyTavern 的自定义 CSS 输入框
        const textArea = document.getElementById('customCSS');
        if (textArea) {
            // 写入内容
            textArea.value = cssText;
            // 触发 input 事件以通知 ST 保存
            textArea.dispatchEvent(new Event('input', { bubbles: true }));
            
            // 强制触发保存设置
            const context = window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : null;
            if (context && context.saveSettingsDebounced) {
                context.saveSettingsDebounced();
            } else if (window.saveSettingsDebounced) {
                window.saveSettingsDebounced();
            }

            toast.success(`主题 "${themeName}" 应用成功！`);
        } else {
            toast.warning("找不到 CSS 输入框，请确保您已打开用户设置面板。");
        }
    } catch (e) {
        console.error(e);
        toast.error(`应用失败: ${e.message}`);
    }
}


// --- 界面创建 (参考参考代码的写法) ---

function createSettingsHtml() {
    // 获取当前设置用于回填 HTML
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

// --- 初始化逻辑 (模仿参考代码结构) ---

function initializePlugin() {
    console.log("[Museum] 初始化...");

    // 1. 确保设置对象存在 (数据迁移/初始化)
    const settings = getExtensionSettings();
    if (settings && !settings[EXTENSION_NAME]) {
        settings[EXTENSION_NAME] = { sbUrl: "", sbKey: "", sbEmail: "", sbPass: "" };
        saveExtensionSettings();
    }

    // 2. 注入 HTML UI
    const targetContainer = document.getElementById('extensions_settings'); // 优先左侧
    const secondaryContainer = document.getElementById('extensions_settings2'); // 备选右侧
    
    // 如果已经存在，不重复注入
    if (document.getElementById(EXTENSION_ID)) return;

    const html = createSettingsHtml();
    
    // 逻辑：如果有右侧容器且不为空，插到右侧；否则插到左侧
    if (secondaryContainer) {
        secondaryContainer.insertAdjacentHTML('beforeend', html);
    } else if (targetContainer) {
        targetContainer.insertAdjacentHTML('beforeend', html);
    } else {
        console.error("[Museum] 找不到扩展面板容器 (#extensions_settings)");
    }

    // 3. 绑定事件监听 (jQuery)
    // 切换配置面板
    $('#museum-config-toggle').on('click', () => $('#museum-auth-panel').slideToggle());
    
    // 保存设置
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

    // 过滤器切换
    $('.museum-filter-btn').on('click', function() {
        $('.museum-filter-btn').removeClass('active');
        $(this).addClass('active');
        currentFilter = $(this).data('filter');
        refreshGallery();
    });

    // 刷新按钮
    $('#museum-refresh-btn').on('click', refreshGallery);

    // 4. 预加载 Supabase SDK
    loadSupabase().then(() => {
        // 尝试自动登录并加载（如果已配置）
        const s = getExtensionSettings()[EXTENSION_NAME];
        if (s && s.sbUrl && s.sbKey) {
            initSupabaseClient().then(() => {
                if (session) refreshGallery();
            });
        }
    });

    console.log("[Museum] 初始化完成");
}

// --- 启动器 (IIFE) ---
(function () {
    // 递归等待 SillyTavern 上下文就绪
    const waitForSillyTavernContext = () => {
        const context = getContext();
        if (context && context.eventSource && context.eventTypes) {
            // 监听 APP_READY 事件
            // 此时 settings.json 已加载，DOM 已构建
            context.eventSource.once(context.eventTypes.APP_READY, () => {
                // 给一点小延迟确保 DOM 容器完全渲染
                setTimeout(initializePlugin, 500);
            });
        } else {
            // 还没准备好，稍后再试
            setTimeout(waitForSillyTavernContext, 100);
        }
    };

    waitForSillyTavernContext();
})();
