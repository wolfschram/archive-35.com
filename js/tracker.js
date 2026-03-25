(function() {
  'use strict';

  var API_URL = 'https://archive-35-com.pages.dev/api/track';
  var FLUSH_INTERVAL = 30000;
  var queue = [];
  var sessionId = '';
  var pageStart = Date.now();

  // Get or create anonymous session ID
  try {
    sessionId = localStorage.getItem('a35_sid');
    if (!sessionId) {
      sessionId = 'anon_' + Math.random().toString(36).substr(2, 12) + '_' + Date.now().toString(36);
      localStorage.setItem('a35_sid', sessionId);
    }
  } catch (e) {
    sessionId = 'no_storage_' + Math.random().toString(36).substr(2, 8);
  }

  /**
   * Check for logged-in user via getAuthState()
   */
  function getUser() {
    if (typeof window.getAuthState === 'function') {
      var auth = window.getAuthState();
      if (auth && auth.email) {
        return { email: auth.email, name: auth.name || '' };
      }
    }
    return null;
  }

  /**
   * Detect mobile device from user agent
   */
  function isMobile() {
    return /Mobi|Android/i.test(navigator.userAgent);
  }

  /**
   * Push an event onto the queue
   */
  function addEvent(type, data) {
    var user = getUser();
    queue.push({
      type: type,
      data: data || {},
      ts: Date.now(),
      url: location.pathname,
      sid: sessionId,
      user: user
    });
  }

  /**
   * Send queued events to the server
   */
  function flush() {
    if (queue.length === 0) return;

    var batch = queue.splice(0, queue.length);
    var payload = JSON.stringify({ events: batch });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(API_URL, new Blob([payload], { type: 'application/json' }));
    } else {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', API_URL, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(payload);
      } catch (e) {
        // Silently fail — don't break the page for analytics
      }
    }
  }

  // --- Auto-flush every 30 seconds ---
  setInterval(flush, FLUSH_INTERVAL);

  // --- Flush + time_on_page on unload ---
  window.addEventListener('beforeunload', function() {
    addEvent('time_on_page', {
      seconds: Math.round((Date.now() - pageStart) / 1000)
    });
    flush();
  });

  // --- Auto-track pageview on load ---
  addEvent('pageview', {
    referrer: document.referrer || '',
    userAgent: navigator.userAgent,
    screen: screen.width + 'x' + screen.height,
    mobile: isMobile()
  });

  // --- Public API ---
  window.A35Track = {
    event: addEvent,
    flush: flush,
    getSessionId: function() { return sessionId; }
  };
})();
