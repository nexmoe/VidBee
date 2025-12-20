// ==UserScript==
// @name       vidbee-quick-download
// @namespace  vidbee
// @version    0.0.1
// @icon       https://vidbee.org/favicon.svg
// @match      https://www.youtube.com/*
// @match      https://youtube.com/*
// @match      https://music.youtube.com/*
// @match      https://www.bilibili.com/*
// @match      https://bilibili.com/*
// @match      https://www.tiktok.com/*
// @match      https://tiktok.com/*
// @match      https://vimeo.com/*
// @match      https://www.vimeo.com/*
// @match      https://www.dailymotion.com/*
// @match      https://dailymotion.com/*
// @match      https://www.twitch.tv/*
// @match      https://twitch.tv/*
// @match      https://twitter.com/*
// @match      https://www.twitter.com/*
// @match      https://x.com/*
// @match      https://www.x.com/*
// @match      https://www.instagram.com/*
// @match      https://instagram.com/*
// @match      https://www.facebook.com/*
// @match      https://facebook.com/*
// @match      https://fb.com/*
// @match      https://www.fb.com/*
// @match      https://www.reddit.com/*
// @match      https://reddit.com/*
// @match      https://soundcloud.com/*
// @match      https://www.soundcloud.com/*
// @match      https://www.nicovideo.jp/*
// @match      https://nicovideo.jp/*
// @match      https://kick.com/*
// @match      https://www.kick.com/*
// @match      https://bandcamp.com/*
// @match      https://*.bandcamp.com/*
// @match      https://www.mixcloud.com/*
// @match      https://mixcloud.com/*
// @grant      GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  const d=new Set;const importCSS = async e=>{d.has(e)||(d.add(e),(t=>{typeof GM_addStyle=="function"?GM_addStyle(t):(document.head||document.documentElement).appendChild(document.createElement("style")).append(t);})(e));};

  const styleCss = '.vidbee-download-container{position:fixed;bottom:16px;right:16px;z-index:9999;transition:all .2s ease;overflow:visible}.vidbee-download-container.vidbee-hidden{opacity:0;pointer-events:none;transform:scale(0)}.vidbee-download-button{position:relative;display:flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;background:#00000080;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fffc;border:1px solid rgba(255,255,255,.1);border-radius:50%;box-shadow:0 2px 8px #0003;cursor:pointer;font-size:0;transition:all .2s ease;opacity:.6;overflow:visible}.vidbee-download-button:hover{opacity:1;background:#000000b3;border-color:#fff3;box-shadow:0 4px 12px #0000004d;transform:scale(1.1)}.vidbee-download-button:active{transform:scale(.95)}.vidbee-download-button svg{flex-shrink:0;stroke:currentColor;width:16px;height:16px}.vidbee-tooltip{position:absolute;right:calc(100% + 8px);top:50%;padding:6px 10px;background:#000000e6;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;font-size:12px;font-weight:500;white-space:nowrap;border-radius:4px;box-shadow:0 2px 8px #0000004d;opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;transform:translateY(-50%) translate(4px);z-index:10000;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;line-height:1}.vidbee-tooltip:after{content:"";position:absolute;left:100%;top:50%;transform:translateY(-50%);border:4px solid transparent;border-left-color:#000000e6}.vidbee-download-button:hover .vidbee-tooltip{opacity:1;transform:translateY(-50%) translate(0)}.vidbee-close-button{position:absolute;top:-6px;right:-6px;display:flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;background:#ff4d4de6;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:50%;box-shadow:0 2px 4px #0000004d;cursor:pointer;font-size:0;transition:all .2s ease;z-index:1;opacity:0;pointer-events:none;overflow:visible}.vidbee-download-container:hover .vidbee-close-button{opacity:1;pointer-events:auto}.vidbee-close-button:hover{background:#ff4d4d;transform:scale(1.15);box-shadow:0 3px 6px #0006}.vidbee-close-button:active{transform:scale(.9)}.vidbee-close-button svg{flex-shrink:0;stroke:currentColor;width:10px;height:10px}.vidbee-close-button .vidbee-tooltip{right:calc(100% + 6px);top:50%;left:auto;transform:translateY(-50%) translate(4px)}.vidbee-close-button .vidbee-tooltip:after{left:100%;top:50%;right:auto;transform:translateY(-50%);border-left-color:#000000e6;border-top-color:transparent}.vidbee-download-container:hover .vidbee-close-button:hover .vidbee-tooltip{opacity:1;transform:translateY(-50%) translate(0)}';
  importCSS(styleCss);
  function getVideoUrl() {
    return window.location.href;
  }
  function hideButtonTemporarily() {
    const container = document.getElementById("vidbee-download-btn");
    if (container) {
      container.classList.add("vidbee-hidden");
      setTimeout(() => {
        if (container) {
          container.classList.remove("vidbee-hidden");
        }
      }, 5e3);
    }
  }
  function createVidBeeButton() {
    if (document.getElementById("vidbee-download-btn")) {
      return;
    }
    const videoUrl = getVideoUrl();
    if (!videoUrl) {
      return;
    }
    const container = document.createElement("div");
    container.id = "vidbee-download-btn";
    container.className = "vidbee-download-container";
    const button = document.createElement("button");
    button.className = "vidbee-download-button";
    button.setAttribute("aria-label", "Download with VidBee");
    button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span class="vidbee-tooltip">Download with VidBee</span>
  `;
    const closeButton = document.createElement("button");
    closeButton.className = "vidbee-close-button";
    closeButton.setAttribute("aria-label", "Hide button");
    closeButton.innerHTML = `
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
    <span class="vidbee-tooltip">Hide</span>
  `;
    closeButton.addEventListener("click", (e) => {
      e.stopPropagation();
      hideButtonTemporarily();
    });
    let clickTimer = null;
    let clickCount = 0;
    button.addEventListener("click", () => {
      clickCount++;
      if (clickCount === 1) {
        clickTimer = window.setTimeout(() => {
          const vidbeeUrl = `vidbee://download?url=${encodeURIComponent(videoUrl)}`;
          window.location.href = vidbeeUrl;
          clickCount = 0;
        }, 300);
      } else if (clickCount === 2) {
        if (clickTimer !== null) {
          clearTimeout(clickTimer);
        }
        clickCount = 0;
        hideButtonTemporarily();
      }
    });
    container.appendChild(button);
    container.appendChild(closeButton);
    document.body.appendChild(container);
  }
  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", createVidBeeButton);
    } else {
      createVidBeeButton();
    }
    let lastUrl = location.href;
    let urlCheckTimer = null;
    const checkUrlChange = () => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        const oldButton = document.getElementById("vidbee-download-btn");
        if (oldButton) {
          oldButton.remove();
        }
        const hostname = window.location.hostname;
        const delay = hostname.includes("bilibili.com") ? 800 : 500;
        setTimeout(createVidBeeButton, delay);
      }
    };
    new MutationObserver(() => {
      if (urlCheckTimer !== null) {
        clearTimeout(urlCheckTimer);
      }
      urlCheckTimer = window.setTimeout(checkUrlChange, 100);
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", () => {
      setTimeout(checkUrlChange, 300);
    });
  }
  init();

})();