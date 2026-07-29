(function () {
  'use strict';

  const editableSelector = [
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[data-allow-copy]',
    '.allow-copy'
  ].join(',');

  function isEditable(target) {
    return target instanceof Element && Boolean(target.closest(editableSelector));
  }

  function isProtectedMedia(target) {
    return target instanceof Element && Boolean(
      target.closest('img, picture, video, canvas, svg, [data-protect-content]')
    );
  }

  const style = document.createElement('style');
  style.textContent = `
    .content-protection-enabled body,
    .content-protection-enabled body * {
      -webkit-user-select: none;
      user-select: none;
      -webkit-user-drag: none;
    }

    .content-protection-enabled input,
    .content-protection-enabled textarea,
    .content-protection-enabled select,
    .content-protection-enabled [contenteditable="true"],
    .content-protection-enabled [data-allow-copy],
    .content-protection-enabled .allow-copy {
      -webkit-user-select: text;
      user-select: text;
    }
  `;
  document.head.appendChild(style);

  document.documentElement.classList.add('content-protection-enabled');

  document.addEventListener('contextmenu', function (event) {
    if (!isEditable(event.target)) {
      event.preventDefault();
    }
  });

  document.addEventListener('dragstart', function (event) {
    if (isProtectedMedia(event.target)) {
      event.preventDefault();
    }
  });

  document.addEventListener('copy', function (event) {
    if (!isEditable(event.target)) {
      event.preventDefault();
    }
  });

  document.addEventListener('cut', function (event) {
    if (!isEditable(event.target)) {
      event.preventDefault();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (isEditable(event.target)) return;

    const key = String(event.key || '').toLowerCase();
    const blocksCopy = (event.ctrlKey || event.metaKey) && ['c', 'x', 's'].includes(key);

    if (blocksCopy) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
})();
