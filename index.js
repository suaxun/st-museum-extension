import {
    extension_settings,
    saveSettingsDebounced
} from "../../../extensions.js";
import {
    saveSettings
} from "../../../power-user.js";
import {
    toastr
} from "../../../toastr.js";

const EXTENSION_NAME = "museum_importer";

// 获取设置
let settings = extension_settings[EXTENSION_NAME] || {};
// 默认值
settings.sbUrl = settings.sbUrl || "";
settings.sbKey = settings.sbKey || "";
settings.sbEmail = settings.sbEmail || "";
settings.sbPass = settings.sbPass || "";

// 全局变量
let supabase = null;
let session = null;
let currentFilter = 'all'; // all, role_card, beautify

// --- Supabase 逻辑 ---

async function loadSupabase() {
    if (window.supabase) return;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = "https://unpkg.com/@supabase/supabase-js@2";
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function initSupabaseClient() {
    if (!settings.sbUrl || !settings.sbKey) return false;
    if (!window.supabase) await loadSupabase();

    try {
        supabase = window.supabase.createClient(settings.sbUrl, settings.sbKey);
        const { data } = await supabase.auth.getSession();
        if (data.session) {
            session = data.session;
            return true;
        } else if (settings.sbEmail && settings.sbPass) {
            return await doLogin();
        }
        return false;
    } catch (e) {
        console.error("Museum Supabase init error:", e);
        return false;
    }
}

async function doLogin() {
    if (!supabase) return false;
    const { data, error } = await supabase.auth.signInWithPassword({
        email: settings.sbEmail,
        password: settings.sbPass
    });
    if (error) throw error;
    session = data.session;
    toastr.success("博物馆登录成功");
    return true;
}

// --- 数据获取与渲染逻辑 ---

async function refreshGallery() {
    const grid = $('#museum-grid');
    grid.empty();
    grid.append('<div class="museum-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>');

    if (!supabase) await initSupabaseClient();
    if (!session) {
        grid.html('<div style="text-align:center; padding:20px;">请先在上方设置中登录</div>');
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
        toastr.error("获取数据失败: " + e.message);
        grid.html('<div style="text-align:center; padding:20px;">加载失败</div>');
    }
}

function renderItems(items) {
    const grid = $('#museum-grid');
    grid.empty();

    if (items.length === 0) {
        grid.html('<div style="text-align:center; padding:20px;">空空如也</div>');
        return;
    }

    items.forEach(item => {
        let title = "未命名";
        let typeLabel = "未知";
        let imgUrl = "";
        
        // 解析数据结构 (兼容你的旧版 Vue 逻辑)
        if (item.type === 'role_card') {
            typeLabel = "角色卡";
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

        // 构建卡片 HTML
        const cardHtml = `
            <div class="museum-item" data-id="${item.id}">
                <img src="${imgUrl}" class="museum-thumb" loading="lazy">
                <div class="museum-info">
                    <div class="museum-type-tag">${typeLabel}</div>
                    <div class="museum-title" title="${title}">${title}</div>
                    <div class="museum-action-btn import-btn">
                        <i class="fa-solid fa-download"></i> 导入
                    </div>
                </div>
            </div>
        `;
        
        const $card = $(cardHtml);
        
        // 绑定点击事件
        $card.find('.import-btn').on('click', () => handleImport(item));
        
        grid.append($card);
    });
}

// --- 核心导入功能 ---

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
            toastr.success(`角色 ${result.name} 已导入！`);
            // 刷新 ST 角色列表 (触发点击刷新按钮)
            $("#rm_button_characters").click();
        } else {
            throw new Error("导入API无响应");
        }
    } catch (e) {
        toastr.error("导入角色失败: " + e.message);
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

        // 写入到 ST 的 Custom CSS 输入框
        const textArea = document.getElementById('customCSS');
        if (textArea) {
            textArea.value = cssText;
            // 触发 input 事件以确保 ST 保存设置
            textArea.dispatchEvent(new Event('input', { bubbles: true }));
            // 确保设置已保存
            saveSettings();
            toastr.success(`主题应用成功！CSS 已替换。`);
        } else {
            toastr.warning("未找到 Custom CSS 输入框，请确保处于用户设置界面。");
        }

    } catch (e) {
        toastr.error("导入美化失败: " + e.message);
    } finally {
        btn.html(originalText);
    }
}

// --- 界面构建 ---

function buildExtensionUI() {
    // 防止重复插入
    if ($('#museum-extension-root').length) return;

    // 构建 HTML 结构
    const html = `
    <div id="museum-extension-root" class="inline-drawer wide100p flexFlowColumn">
        <!-- 抽屉头部 -->
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-building-columns"></i> 博物馆 (Museum)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>

        <!-- 抽屉内容 -->
        <div class="inline-drawer-content museum-drawer-content">
            
            <!-- 1. 顶部操作栏 -->
            <div class="flex-container">
                <div class="menu_button fa-solid fa-arrows-rotate" id="museum-refresh-btn" title="刷新画廊"></div>
                <div class="menu_button fa-solid fa-gear" id="museum-config-toggle" title="配置连接"></div>
            </div>

            <!-- 2. 配置/登录面板 (默认隐藏) -->
            <div id="museum-auth-panel" class="museum-auth-box" style="display:none;">
                <small>Supabase 配置</small>
                <input type="text" id="museum-sb-url" class="text_pole textarea_compact" placeholder="Supabase URL" value="${settings.sbUrl}">
                <input type="password" id="museum-sb-key" class="text_pole textarea_compact" placeholder="Supabase Key" value="${settings.sbKey}">
                <input type="text" id="museum-email" class="text_pole textarea_compact" placeholder="Email" value="${settings.sbEmail}">
                <input type="password" id="museum-pass" class="text_pole textarea_compact" placeholder="Password" value="${settings.sbPass}">
                <button id="museum-save-login-btn" class="menu_button">保存并登录</button>
            </div>

            <!-- 3. 类型过滤器 -->
            <div class="museum-filter-bar">
                <div class="museum-filter-btn active" data-filter="all">全部</div>
                <div class="museum-filter-btn" data-filter="role_card">角色</div>
                <div class="museum-filter-btn" data-filter="beautify">美化</div>
            </div>

            <!-- 4. 内容网格 -->
            <div id="museum-grid" class="museum-grid">
                <div style="grid-column: 1 / -1; text-align: center; padding: 20px; opacity: 0.5;">
                    点击上方刷新按钮加载数据
                </div>
            </div>

        </div>
    </div>
    `;

    // 插入到扩展面板 (#extensions_settings2 通常是右边那一栏，或者插到第一个栏)
    const targetContainer = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    targetContainer.append(html);

    // --- 绑定事件 ---

    // 1. 折叠/展开 配置面板
    $('#museum-config-toggle').on('click', () => {
        $('#museum-auth-panel').slideToggle();
    });

    // 2. 保存并登录
    $('#museum-save-login-btn').on('click', async () => {
        settings.sbUrl = $('#museum-sb-url').val().trim();
        settings.sbKey = $('#museum-sb-key').val().trim();
        settings.sbEmail = $('#museum-email').val().trim();
        settings.sbPass = $('#museum-pass').val().trim();

        // 保存到 ST 的扩展设置
        extension_settings[EXTENSION_NAME] = settings;
        saveSettingsDebounced();

        const success = await initSupabaseClient();
        if (success) {
            $('#museum-auth-panel').slideUp();
            refreshGallery();
        }
    });

    // 3. 过滤器切换
    $('.museum-filter-btn').on('click', function() {
        $('.museum-filter-btn').removeClass('active');
        $(this).addClass('active');
        currentFilter = $(this).data('filter');
        refreshGallery();
    });

    // 4. 刷新按钮
    $('#museum-refresh-btn').on('click', () => {
        refreshGallery();
    });

    // 自动尝试加载
    if (settings.sbUrl && settings.sbKey) {
        initSupabaseClient().then(() => {
            if (session) refreshGallery();
        });
    }
}

// 入口函数
jQuery(async () => {
    // 确保 extension_settings 初始化
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = { sbUrl: "", sbKey: "", sbEmail: "", sbPass: "" };
    }

    // 预加载库
    loadSupabase();

    // 延迟一点加载 UI，确保 ST 的 DOM 已经就绪
    setTimeout(buildExtensionUI, 800);
});
