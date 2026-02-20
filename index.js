// 扩展名称
const EXTENSION_NAME = "museum_importer";

// 全局变量
let supabase = null;
let session = null;
let currentFilter = 'all';

// --- 核心工具函数 ---

// 安全地获取 SillyTavern 的 extension_settings
function getExtensionSettings() {
    // 尝试从不同的全局位置获取设置对象
    if (window.SillyTavern && window.SillyTavern.extension_settings) {
        return window.SillyTavern.extension_settings;
    }
    // 兼容旧版或特定上下文
    if (window.extension_settings) {
        return window.extension_settings;
    }
    // 如果都找不到，返回 null，稍后重试
    return null;
}

// 安全保存设置
function saveExtensionSettings() {
    if (window.SillyTavern && window.SillyTavern.saveSettingsDebounced) {
        window.SillyTavern.saveSettingsDebounced();
    } else if (window.saveSettingsDebounced) {
        window.saveSettingsDebounced();
    }
}

// 获取 Toast 通知
const toast = {
    success: (msg) => window.toastr ? window.toastr.success(msg) : console.log("[Museum Success]", msg),
    error: (msg) => window.toastr ? window.toastr.error(msg) : console.error("[Museum Error]", msg),
    info: (msg) => window.toastr ? window.toastr.info(msg) : console.log("[Museum Info]", msg),
    warning: (msg) => window.toastr ? window.toastr.warning(msg) : console.warn("[Museum Warning]", msg)
};

// --- Supabase 逻辑 ---

async function loadSupabase() {
    if (window.supabase) return;
    
    console.log("[Museum] Loading Supabase SDK...");
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        // 使用更稳定的 JSDelivr UMD 版本，确保浏览器能直接运行
        script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.8/dist/umd/supabase.min.js";
        script.onload = () => {
            console.log("[Museum] Supabase SDK Loaded.");
            resolve();
        };
        script.onerror = (e) => {
            console.error("[Museum] Failed to load Supabase SDK", e);
            reject(e);
        };
        document.head.appendChild(script);
    });
}

async function initSupabaseClient() {
    const settings = getExtensionSettings()?.[EXTENSION_NAME];
    
    if (!settings || !settings.sbUrl || !settings.sbKey) {
        // 配置未填写，不报错，只是不做初始化
        return false;
    }

    if (!window.supabase) await loadSupabase();

    try {
        // 全局对象通常是 window.supabase.createClient
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

// --- UI 交互逻辑 ---

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
        toast.error("获取数据失败: " + e.message);
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
        
        // 解析数据
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

// --- 导入动作 ---

async function handleImport(item) {
    if (item.type === 'role_card') {
        await importRoleCard(item);
    } else if (item.type === 'beautify') {
        await importBeautify(item);
    }
}

async function importRoleCard(item) {
    const btn = $(`div[data-id="${item.id}"] .import-btn`);
    const originalText = btn.html();
    btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');

    try {
        const response = await fetch(item.file_url);
        const blob = await response.blob();
        const file = new File([blob], "card.png", { type: blob.type });

        const formData = new FormData();
        formData.append('avatar', file);

        const res = await fetch('/api/characters/import', { method: 'POST', body: formData });
        const result = await res.json();

        if (result.file_name) {
            toast.success(`角色 "${result.name}" 已导入`);
            // 刷新 ST 角色列表
            if ($("#rm_button_characters").length) {
                $("#rm_button_characters").click(); 
            }
        } else {
            throw new Error("API 返回异常");
        }
    } catch (e) {
        toast.error("角色导入失败: " + e.message);
    } finally {
        btn.html(originalText);
    }
}

async function importBeautify(item) {
    const btn = $(`div[data-id="${item.id}"] .import-btn`);
    const originalText = btn.html();
    btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');

    try {
        let cssUrl = "";
        try {
            const json = JSON.parse(item.content);
            if (json.variations && json.variations[0]) {
                cssUrl = json.variations[0].file;
            }
        } catch(e) {}

        if (!cssUrl) throw new Error("未找到 CSS 链接");

        const res = await fetch(cssUrl);
        const cssText = await res.text();

        if (!cssText) throw new Error("CSS 内容为空");

        const textArea = document.getElementById('customCSS');
        if (textArea) {
            textArea.value = cssText;
            textArea.dispatchEvent(new Event('input', { bubbles: true }));
            saveExtensionSettings(); // 触发 ST 全局保存
            toast.success("主题应用成功");
        } else {
            toast.warning("找不到 CSS 输入框，请确保您在用户设置界面");
        }
    } catch (e) {
        toast.error("美化导入失败: " + e.message);
    } finally {
        btn.html(originalText);
    }
}

// --- UI 构建 ---

function buildExtensionUI(settings) {
    if ($('#museum-extension-root').length) return;

    console.log("[Museum] Building UI...");

    const html = `
    <div id="museum-extension-root" class="inline-drawer wide100p flexFlowColumn">
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

    // 尝试插入到 #extensions_settings2，如果不存在插入到 #extensions_settings
    const target = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    target.append(html);

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
}

// --- 初始化入口 ---

// 循环检查直到 SillyTavern 准备就绪
const initInterval = setInterval(() => {
    // 尝试获取设置对象
    const settings = getExtensionSettings();
    
    // 如果设置对象存在（说明ST已经加载了核心JS）
    if (settings) {
        clearInterval(initInterval);
        
        // 确保本扩展的设置对象已初始化
        if (!settings[EXTENSION_NAME]) {
            settings[EXTENSION_NAME] = {
                sbUrl: "", sbKey: "", sbEmail: "", sbPass: ""
            };
            saveExtensionSettings();
        }

        console.log("[Museum] SillyTavern Ready. Initializing Extension...");
        
        // 开始加载 SDK 并构建 UI
        loadSupabase();
        
        // 稍微延迟 UI 构建以确保 DOM 元素存在
        setTimeout(() => {
            buildExtensionUI(settings[EXTENSION_NAME]);
        }, 500);
    }
}, 500); // 每500毫秒检查一次
