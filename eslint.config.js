/**
 * ESLint flat config for VERO-BAAMBI
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 */

export default [
  {
    // Global ignores
    ignores: [
      'node_modules/**',
      'dist/**',
      '*.min.js',
      'audio-meters-grid.html'
    ]
  },
  {
    // Main configuration for source files
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        // Web Audio API
        AudioContext: 'readonly',
        webkitAudioContext: 'readonly',
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        OfflineAudioContext: 'readonly',
        // Web Workers
        self: 'readonly',
        importScripts: 'readonly',
        // Typed Arrays
        Float32Array: 'readonly',
        Float64Array: 'readonly',
        Int8Array: 'readonly',
        Int16Array: 'readonly',
        Int32Array: 'readonly',
        Uint8Array: 'readonly',
        Uint16Array: 'readonly',
        Uint32Array: 'readonly',
        ArrayBuffer: 'readonly',
        DataView: 'readonly',
        // Other built-ins
        Map: 'readonly',
        Set: 'readonly',
        WeakMap: 'readonly',
        WeakSet: 'readonly',
        Promise: 'readonly',
        Symbol: 'readonly',
        Proxy: 'readonly',
        Reflect: 'readonly',
        // Math & JSON
        Math: 'readonly',
        JSON: 'readonly',
        // Error types
        Error: 'readonly',
        TypeError: 'readonly',
        RangeError: 'readonly',
        // DOM
        Element: 'readonly',
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        CanvasRenderingContext2D: 'readonly',
        ResizeObserver: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        EventTarget: 'readonly',
        // Media
        MediaStream: 'readonly',
        MediaStreamTrack: 'readonly',
        MediaDevices: 'readonly',
        // WebSocket & Network
        WebSocket: 'readonly',
        XMLHttpRequest: 'readonly',
        // Web Audio additional
        AudioWorkletNode: 'readonly',
        GainNode: 'readonly',
        AnalyserNode: 'readonly',
        // DOM additional
        getComputedStyle: 'readonly',
        Node: 'readonly',
        NodeList: 'readonly',
        DOMParser: 'readonly',
        // Crypto
        crypto: 'readonly',
        // Canvas
        Path2D: 'readonly',
        ImageData: 'readonly',
        // Location & Dialogs
        location: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly'
      }
    },
    rules: {
      // ─────────────────────────────────────────────────────────────────────
      // Possible Errors
      // ─────────────────────────────────────────────────────────────────────
      'no-console': 'off',                    // Console is used for debugging
      'no-debugger': 'warn',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-ex-assign': 'error',
      'no-extra-boolean-cast': 'error',
      'no-func-assign': 'error',
      'no-inner-declarations': 'error',
      'no-irregular-whitespace': 'error',
      'no-obj-calls': 'error',
      'no-sparse-arrays': 'error',
      'no-unexpected-multiline': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',

      // ─────────────────────────────────────────────────────────────────────
      // Best Practices
      // ─────────────────────────────────────────────────────────────────────
      'curly': ['error', 'multi-line'],
      'default-case': 'off',
      'dot-notation': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-caller': 'error',
      'no-case-declarations': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-empty-function': 'off',             // Empty functions are sometimes intentional
      'no-empty-pattern': 'error',
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-extra-bind': 'error',
      'no-fallthrough': 'error',
      'no-floating-decimal': 'error',
      'no-global-assign': 'error',
      'no-implied-eval': 'error',
      'no-lone-blocks': 'error',
      'no-loop-func': 'error',
      'no-multi-spaces': 'error',
      'no-new': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-octal': 'error',
      'no-octal-escape': 'error',
      'no-param-reassign': 'off',             // Sometimes useful for defaults
      'no-proto': 'error',
      'no-redeclare': 'error',
      'no-return-assign': ['error', 'except-parens'],
      'no-script-url': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-escape': 'error',
      'no-useless-return': 'error',
      'no-void': 'error',
      'no-with': 'error',
      'prefer-promise-reject-errors': 'error',
      'radix': 'error',
      'yoda': 'error',

      // ─────────────────────────────────────────────────────────────────────
      // Variables
      // ─────────────────────────────────────────────────────────────────────
      'no-delete-var': 'error',
      'no-shadow-restricted-names': 'error',
      'no-undef': 'error',
      'no-unused-vars': ['error', {
        vars: 'all',
        args: 'after-used',
        ignoreRestSiblings: true,
        argsIgnorePattern: '^_'
      }],
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],

      // ─────────────────────────────────────────────────────────────────────
      // Stylistic (minimal - let EditorConfig handle most)
      // ─────────────────────────────────────────────────────────────────────
      'no-mixed-spaces-and-tabs': 'error',
      'no-tabs': 'error',
      'no-trailing-spaces': 'error',
      'semi': ['error', 'always'],
      'semi-spacing': 'error',
      'space-before-blocks': 'error',
      'space-infix-ops': 'error',
      'spaced-comment': ['error', 'always', { markers: ['!', '*', '-', '='] }],

      // ─────────────────────────────────────────────────────────────────────
      // ES6+
      // ─────────────────────────────────────────────────────────────────────
      'arrow-spacing': 'error',
      'constructor-super': 'error',
      'no-class-assign': 'error',
      'no-const-assign': 'error',
      'no-dupe-class-members': 'error',
      'no-duplicate-imports': 'error',
      'no-new-symbol': 'error',
      'no-this-before-super': 'error',
      'no-useless-computed-key': 'error',
      'no-useless-constructor': 'error',
      'no-useless-rename': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      'prefer-const': ['error', { destructuring: 'all' }],
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'prefer-template': 'off',               // Template literals not always clearer
      'require-yield': 'error',
      'rest-spread-spacing': 'error',
      'symbol-description': 'error',
      'template-curly-spacing': 'error'
    }
  },
  {
    // AudioWorklet files run in worker context
    files: ['**/*worklet*.js', '**/*processor*.js'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        currentFrame: 'readonly',
        currentTime: 'readonly',
        sampleRate: 'readonly'
      }
    }
  },
  {
    // Test files
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly'
      }
    }
  }
];
