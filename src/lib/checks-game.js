/**
 * Game-specific quality checks — supplements the standard checks in checks.js
 * with game-relevant validations (game loop, input, performance, audio, etc.)
 */
export function runGameChecks(code) {
  var results = []
  function add(cat, id, label, passed, detail) {
    results.push({ cat: cat, id: id, label: label, passed: passed, detail: detail || '' })
  }
  if (!code || code.length > 800000) {
    add('Game', 'game-size-guard', 'Game file size check', false, 'File too large')
    return results
  }
  try {
    // --- Game Loop ---
    add(
      'Game Loop',
      'has-raf',
      'Uses requestAnimationFrame',
      /requestAnimationFrame/.test(code),
      'Game loop should use requestAnimationFrame, not setInterval/setTimeout'
    )
    add(
      'Game Loop',
      'has-delta-time',
      'Uses delta time for movement',
      /delta|dt|elapsed|frameTime|lastTime|previousTime/i.test(code),
      'Movement should be frame-rate independent using delta time'
    )
    add(
      'Game Loop',
      'has-game-states',
      'Implements game state machine',
      /game.?state|state\s*===?\s*['"`](menu|playing|paused|game.?over)/i.test(code),
      'Game should have distinct states: menu, playing, paused, game over'
    )

    // --- Rendering ---
    var hasCanvas = /<canvas/.test(code) || /getContext\s*\(\s*['"]2d['"]/.test(code)
    var hasWebGL = /getContext\s*\(\s*['"]webgl/.test(code) || /THREE\./.test(code) || /PIXI\./.test(code)
    var hasCSS3D = /perspective\s*\(/.test(code) && /transform-style\s*:\s*preserve-3d/.test(code)
    add(
      'Rendering',
      'has-render-engine',
      'Has rendering engine',
      hasCanvas || hasWebGL || hasCSS3D,
      'Game should use Canvas 2D, WebGL (Three.js/PixiJS), or CSS 3D transforms'
    )

    // --- Input ---
    var hasKeyboard = /keydown|keyup|keypress/.test(code)
    var hasTouch = /touchstart|touchmove|touchend|pointerdown|pointermove|pointerup/.test(code)
    add(
      'Input',
      'has-keyboard',
      'Keyboard input handling',
      hasKeyboard,
      'Game should respond to keyboard input (arrows, WASD, space)'
    )
    add(
      'Input',
      'has-touch',
      'Touch/pointer input handling',
      hasTouch,
      'Game should support touch input for mobile play'
    )
    add(
      'Input',
      'has-prevent-default',
      'Prevents default on game keys',
      /preventDefault/.test(code),
      'Game keys should prevent default to avoid page scrolling during play'
    )

    // --- Collision Detection ---
    add(
      'Game Logic',
      'has-collision',
      'Has collision detection',
      /collision|intersect|overlap|hitTest|hit_test|bounds|AABB|collide/i.test(code),
      'Most games need collision detection between entities'
    )

    // --- Scoring ---
    add(
      'Game Logic',
      'has-score',
      'Has scoring system',
      /score/i.test(code),
      'Game should track and display a score'
    )
    add(
      'Game Logic',
      'has-highscore',
      'Has high score persistence',
      /high.?score|best.?score|top.?score/i.test(code) || (/score/i.test(code) && /localStorage/.test(code)),
      'High scores should persist across sessions via localStorage'
    )

    // --- Difficulty ---
    add(
      'Game Logic',
      'has-difficulty',
      'Has difficulty progression',
      /difficult|speed.*increase|level|wave|faster|harder|progress/i.test(code),
      'Game should get progressively harder over time'
    )

    // --- Audio ---
    var hasAudio = /AudioContext|webkitAudioContext|Howl|Tone\.|new Audio|createOscillator/.test(code)
    add(
      'Audio',
      'has-audio',
      'Has sound effects or music',
      hasAudio,
      'Games benefit greatly from audio feedback — consider adding sound effects'
    )

    // --- Visual Polish ---
    add(
      'Visual Polish',
      'has-particles',
      'Has particle or visual effects',
      /particle|spark|trail|explod|burst|emit/i.test(code),
      'Particle effects add game feel and juice'
    )
    add(
      'Visual Polish',
      'has-animation',
      'Has animation/transitions',
      /animate|transition|tween|lerp|ease|@keyframes/i.test(code),
      'Smooth animations improve perceived quality'
    )

    // --- Performance ---
    var sizeKB = Math.round(new TextEncoder().encode(code).length / 1024)
    add(
      'Performance',
      'game-file-size',
      'Game file size: ' + sizeKB + 'KB',
      sizeKB < 1500,
      sizeKB + 'KB (game limit: 1500KB)'
    )
    add(
      'Performance',
      'no-setinterval-loop',
      'No setInterval for game loop',
      !/setInterval\s*\(\s*(?:function|\w+)\s*,\s*(?:1[0-9]|[1-9])\b/.test(code),
      'Use requestAnimationFrame instead of setInterval for the game loop'
    )
    add(
      'Performance',
      'has-object-pooling',
      'Uses object pooling or recycling',
      /pool|recycle|reuse|inactive|available|dead.*push|free.*push/i.test(code),
      'Object pooling prevents GC pauses during gameplay'
    )

    // --- Responsive ---
    add(
      'Responsive',
      'has-resize-handler',
      'Handles window resize',
      /resize/.test(code),
      'Game canvas/viewport should adapt to window resize'
    )
    add(
      'Responsive',
      'has-viewport-meta',
      'Has viewport meta tag',
      /<meta[^>]{1,200}viewport/i.test(code),
      'Viewport meta tag needed for mobile scaling'
    )

    // --- CDN Libraries ---
    var cdnCount = (code.match(/cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net/g) || []).length
    if (cdnCount > 0) {
      add('Libraries', 'cdn-usage', 'Uses ' + cdnCount + ' CDN library(ies)', true, cdnCount + ' external libraries loaded')
    }
    var hasThreeJS = /THREE\./.test(code)
    var hasMatterJS = /Matter\./.test(code)
    var hasPixiJS = /PIXI\./.test(code)
    if (hasThreeJS) add('Libraries', 'uses-threejs', 'Uses Three.js for 3D rendering', true)
    if (hasMatterJS) add('Libraries', 'uses-matterjs', 'Uses Matter.js for physics', true)
    if (hasPixiJS) add('Libraries', 'uses-pixijs', 'Uses PixiJS for 2D WebGL', true)
  } catch (e) {
    add('Game', 'game-check-error', 'Game check engine error', false, String(e.message || '').slice(0, 80))
  }
  return results
}
