/* TruncGradGS project page — navigation, lazy media viewers, citation copy.
 *
 * Nothing is streamed until it is needed: no <video> carries a src attribute in
 * the markup, and the before/after slider library is injected only when the
 * comparison viewer approaches the viewport.
 *
 * Viewport work goes through one requestAnimationFrame-coalesced handler rather
 * than IntersectionObserver, so the page behaves identically in browsers that
 * throttle or never deliver observer callbacks.
 */
(function () {
  "use strict";

  var layoutHandlers = [];
  var frameQueued = false;

  function flush() {
    frameQueued = false;
    layoutHandlers.slice().forEach(function (handler) { handler(); });
  }

  /**
   * Coalesce viewport work into one batch per frame, with a timer backstop so
   * that a tab which is hidden (and therefore produces no frames) still applies
   * its pending work instead of staying blank until it is scrolled.
   */
  function requestFlush() {
    if (frameQueued) return;
    frameQueued = true;
    var flushed = false;
    function run() {
      if (flushed) return;
      flushed = true;
      flush();
    }
    window.requestAnimationFrame(run);
    window.setTimeout(run, 120);
  }

  function onLayout(handler) {
    layoutHandlers.push(handler);
    return function stop() {
      var index = layoutHandlers.indexOf(handler);
      if (index >= 0) layoutHandlers.splice(index, 1);
    };
  }

  window.addEventListener("scroll", requestFlush, { passive: true });
  window.addEventListener("resize", requestFlush, { passive: true });

  function inViewport(element, margin) {
    var rect = element.getBoundingClientRect();
    var viewport = window.innerHeight || document.documentElement.clientHeight;
    return rect.top < viewport + margin && rect.bottom > -margin;
  }

  /* ------------------------------------------------------------------ nav */

  function initScrollSpy() {
    var links = Array.prototype.slice.call(
      document.querySelectorAll(".nav-links a[href^='#']")
    );
    var sections = links
      .map(function (link) { return document.getElementById(link.getAttribute("href").slice(1)); })
      .filter(Boolean);
    if (!sections.length) return;

    // Anchors land a section just below the sticky header (scroll-padding-top),
    // so the cut-off has to sit below that offset. With a smaller cut-off a
    // section you have just jumped to still counts as "not reached yet" and the
    // highlight only catches up after the next small scroll.
    var scrollPadding = parseFloat(
      window.getComputedStyle(document.documentElement).scrollPaddingTop
    );
    var probe = (isNaN(scrollPadding) ? 72 : scrollPadding) + 12;

    function apply() {
      var currentId = null;
      var atBottom =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2;

      if (atBottom) {
        // A short trailing section may never reach the cut-off, so at the end of
        // the document the last section wins.
        currentId = sections[sections.length - 1].id;
      } else {
        sections.forEach(function (section) {
          if (section.getBoundingClientRect().top <= probe) currentId = section.id;
        });
      }

      links.forEach(function (link) {
        if (currentId !== null && link.getAttribute("href") === "#" + currentId) {
          link.setAttribute("aria-current", "true");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    }

    onLayout(apply);
  }

  /* ---------------------------------------------------------- lazy media */

  /**
   * Assign the real URL to a <video data-src> and start playback. No source is
   * fetched until this runs, which is what keeps the initial page load small.
   */
  function primeVideo(video) {
    if (!video) return;
    var source = video.getAttribute("data-src");
    if (!source) return;
    if (!video.getAttribute("src")) video.setAttribute("src", source);

    var attempt = video.play();
    // Autoplay may be refused while the clip is still buffering; the comparison
    // viewer starts the pair together once both are ready, the gallery simply
    // stays paused.
    if (attempt && typeof attempt.catch === "function") attempt.catch(function () {});
  }

  function playIfPossible(video) {
    var attempt = video.play();
    if (attempt && typeof attempt.catch === "function") attempt.catch(function () {});
  }

  function waitFor(video, event, test, timeout) {
    return new Promise(function (resolve) {
      if (test()) { resolve(); return; }
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        video.removeEventListener(event, done);
        resolve();
      }
      video.addEventListener(event, done, { once: true });
      window.setTimeout(done, timeout);
    });
  }

  /**
   * Start both clips of a panel from the same instant.
   *
   * Correcting a playing clip by writing currentTime is unreliable in Firefox
   * (the seek can be deferred or dropped on a looping video), which leaves the
   * two halves showing different moments — and at a wipe boundary a time offset
   * looks like one side is brighter. Aligning before playback avoids the problem
   * instead of fighting it.
   */
  function startTogether(videos) {
    videos.forEach(primeVideo);
    var ready = videos.map(function (v) {
      return waitFor(v, "canplay", function () { return v.readyState >= 3; }, 6000);
    });
    Promise.all(ready).then(function () {
      videos.forEach(function (v) {
        v.pause();
        try { v.currentTime = 0; } catch (error) { /* not seekable yet */ }
      });
      return Promise.all(videos.map(function (v) {
        return waitFor(v, "seeked", function () { return !v.seeking; }, 1000);
      }));
    }).then(function () {
      videos.forEach(playIfPossible);
    });
  }

  function videosIn(root) {
    return Array.prototype.slice.call(root.querySelectorAll("video"));
  }

  /* ---------------------------------------------------- comparison viewer */

  /**
   * Wipe comparison drawn into a single canvas.
   *
   * The two clips are stacked as invisible <video> elements and composited by
   * our own code into one 2D canvas. Compositing in DOM layers instead (clipped
   * <video> on top of an unclipped one) was measurably wrong in Firefox: the two
   * clips, whose files agree to under a level, rendered with a visible brightness
   * step at the wipe boundary, while the same clip on both sides rendered
   * uniformly. One surface removes that class of difference entirely.
   */
  function initComparisons() {
    var section = document.getElementById("comparisons");
    if (!section) return;

    var tabs = Array.prototype.slice.call(section.querySelectorAll("[role='tab']"));
    var panels = Array.prototype.slice.call(section.querySelectorAll(".panel"));
    if (!tabs.length) return;

    var STEP = 2; // keyboard nudge, in percent

    function setupPanel(panel) {
      // Runs on every tab activation; the DOM must be built exactly once.
      if (panel.dataset.vcViewer === "ready") return;

      var container = panel.querySelector(".vc-slider-container");
      var videos = container ? container.querySelectorAll("video") : [];
      if (!container || videos.length < 2) return;

      // videos[0] is the baseline: it is revealed to the left of the divider and
      // videos[1] to the right, matching the captions.
      var left = videos[0];
      var right = videos[1];

      var canvas = document.createElement("canvas");
      canvas.className = "vc-canvas";
      container.appendChild(canvas);
      var ctx = canvas.getContext("2d");

      var divider = document.createElement("div");
      divider.className = "vc-divider";
      container.appendChild(divider);

      [[left, "vc-caption-left"], [right, "vc-caption-right"]].forEach(function (pair) {
        var label = pair[0].getAttribute("vc-caption");
        if (!label) return;
        var caption = document.createElement("span");
        caption.className = "vc-caption " + pair[1];
        caption.textContent = label;
        container.appendChild(caption);
      });

      container.setAttribute("role", "slider");
      container.setAttribute("aria-label", "Reveal the reconstruction with and without truncated gradients");
      container.setAttribute("aria-valuemin", "0");
      container.setAttribute("aria-valuemax", "100");
      container.setAttribute("aria-valuenow", "50");
      container.tabIndex = 0;

      function position() {
        var raw = parseFloat(container.style.getPropertyValue("--vc-pos"));
        return isNaN(raw) ? 50 : Math.max(0, Math.min(100, raw));
      }

      function setPosition(percent) {
        var value = Math.max(0, Math.min(100, percent));
        container.style.setProperty("--vc-pos", value + "%");
        container.setAttribute("aria-valuenow", String(Math.round(value)));
      }

      function positionFromEvent(event) {
        var box = container.getBoundingClientRect();
        if (!box.width) return;
        setPosition(((event.clientX - box.left) / box.width) * 100);
      }

      function nudge(delta) { setPosition(position() + delta); }

      var dragging = false;
      container.addEventListener("pointerdown", function (event) {
        dragging = true;
        if (container.setPointerCapture) container.setPointerCapture(event.pointerId);
        positionFromEvent(event);
      });
      container.addEventListener("pointerup", function (event) {
        dragging = false;
        if (container.releasePointerCapture) {
          try { container.releasePointerCapture(event.pointerId); } catch (error) { /* already released */ }
        }
      });
      container.addEventListener("pointercancel", function () { dragging = false; });
      container.addEventListener("pointermove", function (event) {
        // Mouse wipes on hover, touch only while pressed.
        if (dragging || event.pointerType === "mouse") positionFromEvent(event);
      });
      container.addEventListener("keydown", function (event) {
        if (event.key === "ArrowLeft") nudge(-STEP);
        else if (event.key === "ArrowRight") nudge(STEP);
        else if (event.key === "Home") setPosition(0);
        else if (event.key === "End") setPosition(100);
        else return;
        event.preventDefault();
      });

      // Both clips loop with the same duration; correct any drift.
      left.addEventListener("timeupdate", function () {
        if (right.readyState > 1 && Math.abs(right.currentTime - left.currentTime) > 0.08) {
          right.currentTime = left.currentTime;
        }
      });
      left.addEventListener("loop", function () {
        if (right.readyState > 1) right.currentTime = left.currentTime;
      });
      left.addEventListener("loadedmetadata", function () {
        if (left.videoWidth && left.videoHeight) {
          container.style.aspectRatio = left.videoWidth + " / " + left.videoHeight;
        }
      });

      /** Fit the backing store to the element size, at device resolution. */
      function resizeCanvas() {
        var rect = container.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        var w = Math.max(1, Math.round(rect.width * dpr));
        var h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      }

      /** Fit a clip inside the canvas the way object-fit: contain would. */
      function drawContained(video, w, h) {
        var vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        var scale = Math.min(w / vw, h / vh);
        var dw = vw * scale, dh = vh * scale;
        ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }

      var background = window.getComputedStyle(container).backgroundColor || "#eef0f4";

      function drawFrame() {
        var w = canvas.width, h = canvas.height;
        if (!w || !h) return;
        // Opaque base: the canvas covers the clips, so it must not leave gaps.
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, w, h);
        // Right of the divider: the second clip.
        if (right.readyState >= 2) drawContained(right, w, h);
        // Left of the divider: the baseline, clipped in canvas space.
        var cut = w * (position() / 100);
        if (left.readyState >= 2 && cut > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, cut, h);
          ctx.clip();
          drawContained(left, w, h);
          ctx.restore();
        }
      }

      function loopIsActive() {
        return !panel.hidden && !document.hidden;
      }

      // A timer rather than requestAnimationFrame: the canvas must also be drawn
      // while the clips are paused, and in some embedding situations animation
      // frame callbacks are never delivered at all.
      window.setInterval(function () {
        if (!loopIsActive()) return;
        resizeCanvas();
        drawFrame();
      }, 1000 / 30);

      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) { resizeCanvas(); drawFrame(); }
      });
      left.addEventListener("loadeddata", function () { resizeCanvas(); drawFrame(); });
      right.addEventListener("loadeddata", function () { resizeCanvas(); drawFrame(); });
      container.addEventListener("pointermove", function () { resizeCanvas(); drawFrame(); });
      container.addEventListener("keydown", function () { resizeCanvas(); drawFrame(); });
      resizeCanvas();
      drawFrame();

      panel.dataset.vcViewer = "ready";
    }

    function selectTab(tab, focusTab) {
      var panelId = tab.getAttribute("aria-controls");

      tabs.forEach(function (other) {
        var selected = other === tab;
        other.setAttribute("aria-selected", selected ? "true" : "false");
        other.tabIndex = selected ? 0 : -1;
      });

      panels.forEach(function (panel) {
        var active = panel.id === panelId;
        panel.classList.toggle("is-active", active);
        panel.hidden = !active;
        // Hidden clips keep their buffered data but stop consuming CPU.
        if (!active) videosIn(panel).forEach(function (video) { video.pause(); });
      });

      var panel = document.getElementById(panelId);
      if (!panel) return;
      setupPanel(panel);
      videosIn(panel).forEach(primeVideo);
      if (focusTab) tab.focus();
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () { selectTab(tab); });
      tab.addEventListener("keydown", function (event) {
        var offset = 0;
        if (event.key === "ArrowRight") offset = 1;
        else if (event.key === "ArrowLeft") offset = -1;
        else if (event.key === "Home") offset = -index;
        else if (event.key === "End") offset = tabs.length - 1 - index;
        else return;
        event.preventDefault();
        selectTab(tabs[(index + offset + tabs.length) % tabs.length], true);
      });
    });

    var initial = tabs.filter(function (tab) {
      return tab.getAttribute("aria-selected") === "true";
    })[0] || tabs[0];

    var stop = onLayout(function () {
      if (!inViewport(section, 500)) return;
      stop();
      selectTab(initial);
    });
  }

  /* ------------------------------------------------------ dataset gallery */

  function initSceneGallery() {
    var cards = Array.prototype.slice.call(document.querySelectorAll(".scene"));
    if (!cards.length) return;

    var entries = cards.map(function (card) {
      var video = card.querySelector("video");
      if (video) {
        // A clip that is not in the repository yet leaves the card in its
        // "coming soon" state; adding the file makes the card fill itself in.
        video.addEventListener("error", function () { card.classList.add("is-pending"); });
        video.addEventListener("loadeddata", function () { card.classList.remove("is-pending"); });
      }
      return { card: card, video: video, playing: false };
    });

    onLayout(function () {
      entries.forEach(function (entry) {
        if (!entry.video) return;
        var visible = inViewport(entry.card, 200);
        if (visible === entry.playing) return;
        entry.playing = visible;
        if (visible) primeVideo(entry.video);
        else entry.video.pause();
      });
    });
  }

  /* ------------------------------------------------------------ citation */

  function initCopyButton() {
    var button = document.querySelector(".copy-btn");
    var source = document.getElementById("bibtex");
    if (!button || !source || !navigator.clipboard) return;

    button.addEventListener("click", function () {
      navigator.clipboard.writeText(source.textContent.trim()).then(function () {
        button.textContent = "Copied";
        button.setAttribute("data-copied", "true");
        window.setTimeout(function () {
          button.textContent = "Copy";
          button.removeAttribute("data-copied");
        }, 1800);
      });
    });
  }

  /* ---------------------------------------------------------------- init */

  function init() {
    initScrollSpy();
    initComparisons();
    initSceneGallery();
    initCopyButton();
    requestFlush();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
