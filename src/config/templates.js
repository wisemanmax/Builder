// Template categories for the gallery filter
export const TEMPLATE_CATEGORIES = [
  { id: 'productivity', name: 'Productivity', icon: '\u26A1' },
  { id: 'games', name: 'Games', icon: '\uD83C\uDFAE' },
  { id: 'dashboards', name: 'Dashboards', icon: '\uD83D\uDCCA' },
  { id: 'landing', name: 'Landing Pages', icon: '\uD83C\uDF10' },
  { id: 'portfolios', name: 'Portfolios', icon: '\uD83C\uDFA8' },
  { id: 'tools', name: 'Tools', icon: '\uD83D\uDD27' },
]

// Each template is a structural skeleton that Claude expands into a full app
export const TEMPLATES = [
  {
    id: 'habit-tracker',
    name: 'Habit Tracker',
    icon: '\uD83D\uDD25',
    category: 'productivity',
    desc: 'Daily habits with streaks and calendar heatmap',
    skeleton: `<!DOCTYPE html>
<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>The Ritual - Daily Dashboard</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"><\/script>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,700;0,800;1,800&amp;family=Be+Vietnam+Pro:wght@400;500;600&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "on-tertiary": "#f7f0ff",
                        "surface-bright": "#f5f6f7",
                        "surface-variant": "#dadddf",
                        "secondary": "#9b3f00",
                        "surface-container-low": "#eff1f2",
                        "tertiary-fixed": "#b8a3ff",
                        "on-secondary-fixed-variant": "#893700",
                        "secondary-fixed": "#ffc5aa",
                        "on-tertiary-fixed-variant": "#4000ad",
                        "on-secondary-container": "#7b3100",
                        "surface-tint": "#006859",
                        "error": "#b31b25",
                        "tertiary": "#652fe7",
                        "on-surface-variant": "#595c5d",
                        "secondary-dim": "#883700",
                        "tertiary-container": "#b8a3ff",
                        "on-surface": "#2c2f30",
                        "surface-container-high": "#e0e3e4",
                        "surface": "#f5f6f7",
                        "on-tertiary-container": "#370096",
                        "tertiary-dim": "#5819db",
                        "on-secondary-fixed": "#5c2300",
                        "on-primary-fixed-variant": "#006455",
                        "background": "#f5f6f7",
                        "primary": "#006859",
                        "on-error": "#ffefee",
                        "surface-dim": "#d1d5d7",
                        "on-secondary": "#fff0ea",
                        "inverse-on-surface": "#9b9d9e",
                        "on-tertiary-fixed": "#1c0055",
                        "primary-fixed": "#61f4d8",
                        "inverse-primary": "#6bfde0",
                        "on-primary": "#c2ffef",
                        "error-dim": "#9f0519",
                        "tertiary-fixed-dim": "#ab93ff",
                        "surface-container": "#e6e8ea",
                        "surface-container-lowest": "#ffffff",
                        "on-primary-fixed": "#00443a",
                        "secondary-fixed-dim": "#ffb28c",
                        "primary-fixed-dim": "#4fe5ca",
                        "surface-container-highest": "#dadddf",
                        "error-container": "#fb5151",
                        "primary-container": "#61f4d8",
                        "inverse-surface": "#0c0f10",
                        "primary-dim": "#005a4d",
                        "secondary-container": "#ffc5aa",
                        "on-error-container": "#570008",
                        "on-background": "#2c2f30",
                        "on-primary-container": "#00594c",
                        "outline": "#757778",
                        "outline-variant": "#abadae"
                    },
                    fontFamily: {
                        "headline": ["Plus Jakarta Sans"],
                        "body": ["Be Vietnam Pro"],
                        "label": ["Be Vietnam Pro"]
                    },
                    borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
                },
            },
        }
    <\/script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        body {
            font-family: 'Be Vietnam Pro', sans-serif;
            background-color: #f5f6f7;
            color: #2c2f30;
        }
    </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="bg-surface selection:bg-primary-container selection:text-on-primary-container">
<!-- TopAppBar -->
<nav class="fixed top-0 w-full z-50 bg-zinc-50/80 backdrop-blur-md shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)]">
<div class="flex justify-between items-center px-6 py-4 w-full">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-teal-600" data-icon="spa">spa</span>
<span class="font-['Plus_Jakarta_Sans'] text-teal-700 font-black italic tracking-tighter text-lg">The Ritual</span>
</div>
<div class="flex items-center gap-4">
<button class="material-symbols-outlined text-zinc-500 hover:bg-zinc-200/50 p-2 rounded-full transition-colors active:scale-95" data-icon="notifications">notifications</button>
<div class="w-10 h-10 rounded-full bg-surface-container-highest overflow-hidden active:scale-95 transition-transform duration-200">
<img alt="User Profile Avatar" class="w-full h-full object-cover" data-alt="Close up portrait of a smiling woman" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCwI2PgqYGQAKzYeZu1kkwMdj0NLsnH4u4_IJuwWmU_SbSfVsFFlIBb2VfOS6d-cfhmOa4PetWK95pMdin4_hHn3ENtKKDXuWtJ56xRQs3RZZh45u6Ql108T6VlUiT6P2I-2OByMfJfIVYwCL5NxIg8Xr5kfiJB4Caum4jz2ciDLkeCiW66166yhV74y4ZyEJGNhf3ViXJkh8nJJ_ONOTw5f1aN9EMNDU2OabwVbxis-aQqHagEFfcHn4mgDtJ1Oli3vNN_zXmm3Uk"/>
</div>
</div>
</div>
</nav>
<main class="pt-24 pb-32 px-6 max-w-5xl mx-auto">
<!-- Header Section -->
<header class="mb-10">
<p class="font-label text-on-surface-variant text-sm tracking-widest uppercase mb-1">Monday, Oct 24</p>
<h1 class="font-headline text-4xl font-extrabold tracking-tight text-on-surface">Good morning, Alex.</h1>
<p class="font-body text-on-surface-variant mt-2">Your focus today: <span class="text-primary font-semibold">Mindful Resilience</span></p>
</header>
<!-- Progress Overview Grid -->
<section class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
<!-- Main Progress Ring -->
<div class="md:col-span-2 bg-surface-container-lowest rounded-[2.5rem] p-8 flex items-center justify-between shadow-[0_12px_24px_-4px_rgba(44,47,48,0.06)] overflow-hidden relative">
<div class="relative z-10">
<h2 class="font-headline text-2xl font-bold mb-2">Daily Momentum</h2>
<p class="font-body text-on-surface-variant max-w-[200px]">You've completed 4 of 7 habits today. Keep it up!</p>
<button class="mt-6 px-6 py-3 bg-primary text-on-primary font-semibold rounded-full flex items-center gap-2 active:scale-95 transition-all shadow-[0_8px_16px_-4px_rgba(0,104,89,0.3)]">
                        View Stats <span class="material-symbols-outlined text-sm" data-icon="arrow_forward">arrow_forward</span>
</button>
</div>
<div class="relative flex items-center justify-center">
<svg class="w-40 h-40 transform -rotate-90">
<circle class="text-surface-container-high" cx="80" cy="80" fill="transparent" r="70" stroke="currentColor" stroke-width="12"></circle>
<circle class="text-primary" cx="80" cy="80" fill="transparent" r="70" stroke="currentColor" stroke-dasharray="440" stroke-dashoffset="176" stroke-linecap="round" stroke-width="12"></circle>
</svg>
<div class="absolute inset-0 flex flex-col items-center justify-center">
<span class="font-headline text-4xl font-extrabold tracking-tighter">60%</span>
</div>
</div>
</div>
<!-- Mini Streak Card -->
<div class="bg-primary-container/80 backdrop-blur-xl rounded-[2.5rem] p-8 flex flex-col justify-between shadow-[0_12px_24px_-4px_rgba(0,104,89,0.1)]">
<div>
<span class="material-symbols-outlined text-primary text-3xl mb-4" data-icon="local_fire_department" data-weight="fill">local_fire_department</span>
<h3 class="font-headline text-xl font-bold text-on-primary-container">12 Day Streak</h3>
</div>
<p class="font-body text-on-primary-container/80 text-sm">Consistent for 1.5 weeks. You're building lasting change.</p>
</div>
</section>
<!-- Habit List Section -->
<section>
<div class="flex justify-between items-end mb-6">
<h2 class="font-headline text-2xl font-bold">Your Rituals</h2>
<button class="text-primary font-semibold text-sm hover:underline">Manage All</button>
</div>
<div class="space-y-4">
<!-- Habit Card 1 (Completed) -->
<div class="group flex items-center bg-teal-50/50 rounded-3xl p-5 transition-all duration-400 ease-out">
<div class="flex-shrink-0 mr-5">
<div class="w-12 h-12 rounded-2xl bg-primary text-on-primary flex items-center justify-center scale-110 shadow-lg">
<span class="material-symbols-outlined" data-icon="check">check</span>
</div>
</div>
<div class="flex-grow">
<div class="flex items-center gap-2">
<h4 class="font-headline font-bold text-lg line-through text-on-surface-variant">10-min Meditation</h4>
<span class="px-2 py-0.5 rounded-full bg-tertiary-container text-tertiary text-[10px] font-bold uppercase tracking-wider">Wellness</span>
</div>
<p class="font-body text-sm text-on-surface-variant">Completed at 7:15 AM</p>
</div>
<button class="material-symbols-outlined text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity" data-icon="more_vert">more_vert</button>
</div>
<!-- Habit Card 2 (Active) -->
<div class="group flex items-center bg-surface-container-lowest rounded-3xl p-5 hover:translate-x-1 transition-all duration-300">
<div class="flex-shrink-0 mr-5">
<button class="w-12 h-12 rounded-2xl border-2 border-outline-variant/30 flex items-center justify-center hover:border-primary/50 transition-colors active:scale-90">
<span class="material-symbols-outlined text-zinc-300 group-hover:text-primary transition-colors" data-icon="water_drop">water_drop</span>
</button>
</div>
<div class="flex-grow">
<div class="flex items-center gap-2">
<h4 class="font-headline font-bold text-lg text-on-surface">Drink 2L Water</h4>
<span class="px-2 py-0.5 rounded-full bg-secondary-container text-secondary text-[10px] font-bold uppercase tracking-wider">Health</span>
</div>
<p class="font-body text-sm text-on-surface-variant">1.2L of 2.0L reached</p>
</div>
<div class="flex items-center gap-4">
<div class="h-1.5 w-24 bg-surface-container-low rounded-full overflow-hidden">
<div class="h-full bg-secondary w-[60%] rounded-full"></div>
</div>
<button class="material-symbols-outlined text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity" data-icon="add_circle">add_circle</button>
</div>
</div>
<!-- Habit Card 3 (Active) -->
<div class="group flex items-center bg-surface-container-lowest rounded-3xl p-5 hover:translate-x-1 transition-all duration-300">
<div class="flex-shrink-0 mr-5">
<button class="w-12 h-12 rounded-2xl border-2 border-outline-variant/30 flex items-center justify-center hover:border-primary/50 transition-colors active:scale-90">
<span class="material-symbols-outlined text-zinc-300 group-hover:text-primary transition-colors" data-icon="auto_stories">auto_stories</span>
</button>
</div>
<div class="flex-grow">
<div class="flex items-center gap-2">
<h4 class="font-headline font-bold text-lg text-on-surface">Read 10 Pages</h4>
<span class="px-2 py-0.5 rounded-full bg-tertiary-container text-tertiary text-[10px] font-bold uppercase tracking-wider">Mindset</span>
</div>
<p class="font-body text-sm text-on-surface-variant">"Atomic Habits" by James Clear</p>
</div>
<button class="material-symbols-outlined text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity" data-icon="more_vert">more_vert</button>
</div>
<!-- Habit Card 4 (Active) -->
<div class="group flex items-center bg-surface-container-lowest rounded-3xl p-5 hover:translate-x-1 transition-all duration-300">
<div class="flex-shrink-0 mr-5">
<button class="w-12 h-12 rounded-2xl border-2 border-outline-variant/30 flex items-center justify-center hover:border-primary/50 transition-colors active:scale-90">
<span class="material-symbols-outlined text-zinc-300 group-hover:text-primary transition-colors" data-icon="fitness_center">fitness_center</span>
</button>
</div>
<div class="flex-grow">
<div class="flex items-center gap-2">
<h4 class="font-headline font-bold text-lg text-on-surface">Evening Stretching</h4>
<span class="px-2 py-0.5 rounded-full bg-secondary-container text-secondary text-[10px] font-bold uppercase tracking-wider">Fitness</span>
</div>
<p class="font-body text-sm text-on-surface-variant">Scheduled for 8:30 PM</p>
</div>
<button class="material-symbols-outlined text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity" data-icon="more_vert">more_vert</button>
</div>
</div>
</section>
</main>
<!-- Floating Action Button -->
<button class="fixed right-6 bottom-28 w-16 h-16 bg-primary text-on-primary rounded-[1.5rem] shadow-[0_12px_24px_rgba(0,104,89,0.3)] flex items-center justify-center z-50 active:scale-90 transition-transform duration-200">
<span class="material-symbols-outlined text-3xl" data-icon="add">add</span>
</button>
<!-- BottomNavBar -->
<nav class="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-8 pt-4 bg-white/90 backdrop-blur-xl shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)] rounded-t-[2.5rem] z-50">
<!-- Today (Active) -->
<a class="flex flex-col items-center justify-center bg-teal-50 text-teal-700 rounded-3xl px-5 py-2 active:scale-90 transition-all duration-300 ease-out" href="#">
<span class="material-symbols-outlined" data-icon="calendar_today" data-weight="fill">calendar_today</span>
<span class="font-['Plus_Jakarta_Sans'] text-[10px] font-semibold uppercase tracking-widest mt-1">Today</span>
</a>
<!-- Library -->
<a class="flex flex-col items-center justify-center text-zinc-400 px-5 py-2 hover:text-teal-500 active:scale-90 transition-all duration-300 ease-out" href="#">
<span class="material-symbols-outlined" data-icon="explore">explore</span>
<span class="font-['Plus_Jakarta_Sans'] text-[10px] font-semibold uppercase tracking-widest mt-1">Library</span>
</a>
<!-- Stats -->
<a class="flex flex-col items-center justify-center text-zinc-400 px-5 py-2 hover:text-teal-500 active:scale-90 transition-all duration-300 ease-out" href="#">
<span class="material-symbols-outlined" data-icon="insights">insights</span>
<span class="font-['Plus_Jakarta_Sans'] text-[10px] font-semibold uppercase tracking-widest mt-1">Stats</span>
</a>
<!-- Profile -->
<a class="flex flex-col items-center justify-center text-zinc-400 px-5 py-2 hover:text-teal-500 active:scale-90 transition-all duration-300 ease-out" href="#">
<span class="material-symbols-outlined" data-icon="person">person</span>
<span class="font-['Plus_Jakarta_Sans'] text-[10px] font-semibold uppercase tracking-widest mt-1">Profile</span>
</a>
</nav>
</body></html>`,
  },
  {
    id: 'pomodoro',
    name: 'Pomodoro Timer',
    icon: '\u23F1\uFE0F',
    category: 'productivity',
    desc: 'Focus timer with intervals and session history',
    skeleton: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Pomodoro Timer</title>\n<style>\n:root{--bg:#0a0a1a;--surface:#12122a;--border:rgba(255,255,255,.08);--text:#e8e8f0;--text2:rgba(255,255,255,.55);--accent:#FF3CAC;--accent2:#00E5FF;--success:#00E676;--radius:12px}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;align-items:center;justify-content:center}\n.container{max-width:480px;width:100%;padding:16px;text-align:center}\n/* TEMPLATE: Timer circle/ring styles, control buttons, session history list */\n/* TEMPLATE: Responsive breakpoints */\n@media(min-width:768px){.container{padding:32px}}\n</style>\n</head>\n<body>\n<div class="container">\n<!-- TEMPLATE: Timer display (circular progress), start/pause/reset buttons -->\n<!-- TEMPLATE: Session type selector (focus/short break/long break) -->\n<!-- TEMPLATE: Session history with timestamps -->\n<!-- TEMPLATE: Settings panel for custom intervals -->\n</div>\n<script>\nvar state = { minutes: 25, seconds: 0, running: false, mode: \'focus\', sessions: [], settings: { focus: 25, shortBreak: 5, longBreak: 15 } }\nvar timer = null\nfunction init() { load(); render() }\nfunction load() { try { var s = localStorage.getItem(\'pomo_data\'); if (s) { var d = JSON.parse(s); state.sessions = d.sessions || []; state.settings = d.settings || state.settings } } catch(e){} }\nfunction save() { try { localStorage.setItem(\'pomo_data\', JSON.stringify({ sessions: state.sessions, settings: state.settings })) } catch(e){} }\nfunction render() { /* TEMPLATE: Update timer display, session list, controls */ }\n/* TEMPLATE: Timer logic, mode switching, notification on complete, history tracking */\ndocument.addEventListener(\'DOMContentLoaded\', init)\n</script>\n</body>\n</html>',
  },
  {
    id: 'kanban',
    name: 'Kanban Board',
    icon: '\uD83D\uDCCB',
    category: 'productivity',
    desc: 'Drag-and-drop task board with columns',
    skeleton: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Kanban Board</title>\n<style>\n:root{--bg:#0a0a1a;--surface:#12122a;--border:rgba(255,255,255,.08);--text:#e8e8f0;--text2:rgba(255,255,255,.55);--accent:#3D5AFE;--accent2:#FF3CAC;--success:#00E676;--warning:#FFD600;--radius:12px}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}\n.board{display:flex;gap:16px;padding:16px;overflow-x:auto;min-height:calc(100vh - 64px)}\n.column{min-width:280px;flex:1;background:var(--surface);border-radius:var(--radius);padding:12px;display:flex;flex-direction:column;gap:8px}\n/* TEMPLATE: Card styles, drag states, add-task form, column headers */\n/* TEMPLATE: Mobile: stack columns vertically with horizontal scroll */\n@media(max-width:768px){.board{flex-direction:column;overflow-x:visible}.column{min-width:100%}}\n</style>\n</head>\n<body>\n<header style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between">\n<!-- TEMPLATE: Board title, add-column button -->\n</header>\n<div class="board" id="board">\n<!-- TEMPLATE: Columns (To Do, In Progress, Done) with draggable cards -->\n</div>\n<script>\nvar state = { columns: [ { id: \'todo\', name: \'To Do\', cards: [] }, { id: \'progress\', name: \'In Progress\', cards: [] }, { id: \'done\', name: \'Done\', cards: [] } ] }\nfunction init() { load(); render() }\nfunction load() { try { var s = localStorage.getItem(\'kanban_data\'); if (s) state = JSON.parse(s) } catch(e){} }\nfunction save() { try { localStorage.setItem(\'kanban_data\', JSON.stringify(state)) } catch(e){} }\nfunction render() { /* TEMPLATE: Render columns and cards with drag handles */ }\n/* TEMPLATE: Drag-and-drop logic, card CRUD, column management */\ndocument.addEventListener(\'DOMContentLoaded\', init)\n</script>\n</body>\n</html>',
  },
  {
    id: 'quiz-game',
    name: 'Quiz Game',
    icon: '\uD83E\uDDE0',
    category: 'games',
    desc: 'Interactive quiz with scoring and categories',
    skeleton: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Quiz Game</title>\n<style>\n:root{--bg:#0a0a1a;--surface:#12122a;--border:rgba(255,255,255,.08);--text:#e8e8f0;--text2:rgba(255,255,255,.55);--accent:#B44FFF;--accent2:#00E5FF;--success:#00E676;--error:#FF5252;--radius:12px}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;align-items:center;justify-content:center}\n.container{max-width:600px;width:100%;padding:16px}\n/* TEMPLATE: Question card, answer buttons, progress bar, score display, results screen */\n/* TEMPLATE: Animations for correct/wrong answers */\n@media(min-width:768px){.container{padding:32px}}\n</style>\n</head>\n<body>\n<div class="container">\n<!-- TEMPLATE: Start screen with category selection -->\n<!-- TEMPLATE: Question display with multiple-choice answers -->\n<!-- TEMPLATE: Progress bar and score counter -->\n<!-- TEMPLATE: Results screen with stats and replay -->\n</div>\n<script>\nvar state = { view: \'start\', questions: [], current: 0, score: 0, answers: [], highScores: [] }\nfunction init() { load(); render() }\nfunction load() { try { var s = localStorage.getItem(\'quiz_data\'); if (s) state.highScores = JSON.parse(s).highScores || [] } catch(e){} }\nfunction save() { try { localStorage.setItem(\'quiz_data\', JSON.stringify({ highScores: state.highScores })) } catch(e){} }\nfunction render() { /* TEMPLATE: Render current view (start, question, results) */ }\n/* TEMPLATE: Question generation, answer checking, scoring, category filtering, timer */\ndocument.addEventListener(\'DOMContentLoaded\', init)\n</script>\n</body>\n</html>',
  },
  {
    id: 'analytics-dashboard',
    name: 'Analytics Dashboard',
    icon: '\uD83D\uDCCA',
    category: 'dashboards',
    desc: 'Data dashboard with charts and KPI cards',
    skeleton: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Analytics Dashboard</title>\n<style>\n:root{--bg:#0a0a1a;--surface:#12122a;--border:rgba(255,255,255,.08);--text:#e8e8f0;--text2:rgba(255,255,255,.55);--accent:#3D5AFE;--accent2:#00E5FF;--success:#00E676;--warning:#FFD600;--error:#FF5252;--radius:12px}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}\n.dashboard{max-width:1200px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:16px}\n.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}\n.chart-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:16px}\n/* TEMPLATE: KPI card, chart container, sidebar nav, data table styles */\n@media(max-width:768px){.chart-grid{grid-template-columns:1fr}.kpi-grid{grid-template-columns:repeat(2,1fr)}}\n@media(max-width:480px){.kpi-grid{grid-template-columns:1fr}}\n</style>\n</head>\n<body>\n<div class="dashboard">\n<header style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">\n<!-- TEMPLATE: Dashboard title, date range picker, refresh button -->\n</header>\n<section class="kpi-grid">\n<!-- TEMPLATE: KPI cards (revenue, users, conversion, growth) -->\n</section>\n<section class="chart-grid">\n<!-- TEMPLATE: Line chart (canvas), bar chart (canvas), pie chart -->\n</section>\n<!-- TEMPLATE: Data table with sorting and filtering -->\n</div>\n<script>\nvar state = { data: [], dateRange: \'7d\', view: \'overview\' }\nfunction init() { load(); generateDemoData(); render() }\nfunction load() { try { var s = localStorage.getItem(\'dash_data\'); if (s) state = JSON.parse(s) } catch(e){} }\nfunction save() { try { localStorage.setItem(\'dash_data\', JSON.stringify(state)) } catch(e){} }\nfunction generateDemoData() { /* TEMPLATE: Generate realistic demo data */ }\nfunction render() { /* TEMPLATE: Render KPIs, charts (canvas), tables */ }\n/* TEMPLATE: Chart drawing on canvas, data aggregation, date filtering, export */\ndocument.addEventListener(\'DOMContentLoaded\', init)\n</script>\n</body>\n</html>',
  },
  {
    id: 'weather-app',
    name: 'Weather App',
    icon: '\u26C5',
    category: 'dashboards',
    desc: 'Weather dashboard with forecasts and conditions',
    skeleton: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Weather App</title>\n<style>\n:root{--bg:#0a0a1a;--surface:#12122a;--border:rgba(255,255,255,.08);--text:#e8e8f0;--text2:rgba(255,255,255,.55);--accent:#00E5FF;--accent2:#3D5AFE;--success:#00E676;--warning:#FFD600;--radius:12px}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}\n.container{max-width:600px;width:100%;margin:0 auto;padding:16px}\n/* TEMPLATE: Current weather card, forecast row, details grid, location search */\n@media(min-width:768px){.container{max-width:800px;padding:24px}}\n</style>\n</head>\n<body>\n<div class="container">\n<!-- TEMPLATE: Location search bar -->\n<!-- TEMPLATE: Current weather hero (icon, temp, condition, feels-like) -->\n<!-- TEMPLATE: Hourly forecast horizontal scroll -->\n<!-- TEMPLATE: 7-day forecast list -->\n<!-- TEMPLATE: Details grid (humidity, wind, UV, pressure) -->\n</div>\n<script>\nvar state = { locations: [], current: null, unit: \'C\', view: \'main\' }\nfunction init() { load(); generateDemoData(); render() }\nfunction load() { try { var s = localStorage.getItem(\'weather_data\'); if (s) state = JSON.parse(s) } catch(e){} }\nfunction save() { try { localStorage.setItem(\'weather_data\', JSON.stringify(state)) } catch(e){} }\nfunction generateDemoData() { /* TEMPLATE: Realistic weather demo data for multiple days */ }\nfunction render() { /* TEMPLATE: Render current conditions, forecasts, details */ }\n/* TEMPLATE: Location management, unit toggle, weather icon mapping, forecast display */\ndocument.addEventListener(\'DOMContentLoaded\', init)\n</script>\n</body>\n</html>',
  },
  {
    id: 'portfolio',
    name: 'Portfolio Site',
    icon: '\uD83C\uDFA8',
    category: 'portfolios',
    desc: 'Personal portfolio with projects and contact',
    skeleton: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Portfolio</title>\n<style>\n:root{--bg:#0a0a1a;--surface:#12122a;--border:rgba(255,255,255,.08);--text:#e8e8f0;--text2:rgba(255,255,255,.55);--accent:#FF3CAC;--accent2:#3D5AFE;--success:#00E676;--radius:12px}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);scroll-behavior:smooth}\nnav{position:fixed;top:0;width:100%;background:rgba(10,10,26,.9);backdrop-filter:blur(12px);z-index:100;padding:12px 24px;display:flex;align-items:center;justify-content:space-between}\n.section{max-width:1000px;margin:0 auto;padding:80px 16px 40px}\n.project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}\n/* TEMPLATE: Hero section, about section, project cards, skills grid, contact form */\n@media(max-width:768px){.project-grid{grid-template-columns:1fr}nav{padding:10px 16px}}\n</style>\n</head>\n<body>\n<nav>\n<!-- TEMPLATE: Logo/name, nav links (About, Projects, Skills, Contact), hamburger on mobile -->\n</nav>\n<!-- TEMPLATE: Hero section with name, title, CTA -->\n<section class="section" id="about">\n<!-- TEMPLATE: About me with photo placeholder and bio -->\n</section>\n<section class="section" id="projects">\n<div class="project-grid">\n<!-- TEMPLATE: Project cards with image, title, description, tech tags, links -->\n</div>\n</section>\n<!-- TEMPLATE: Skills section with categorized skill bars/tags -->\n<!-- TEMPLATE: Contact section with form -->\n<script>\nvar state = { menuOpen: false }\nfunction init() { render(); setupNav() }\nfunction setupNav() { /* TEMPLATE: Mobile hamburger toggle, smooth scroll, active section highlight */ }\nfunction render() { /* TEMPLATE: Render projects, skills, animate on scroll */ }\n/* TEMPLATE: Scroll animations, form handling, mobile nav, project filtering */\ndocument.addEventListener(\'DOMContentLoaded\', init)\n</script>\n</body>\n</html>',
  },
  {
    id: 'landing-page',
    name: 'SaaS Landing Page',
    icon: '\uD83D\uDE80',
    category: 'landing',
    desc: 'Product landing page with features and pricing',
    skeleton: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Product Landing Page</title>\n<style>\n:root{--bg:#0a0a1a;--surface:#12122a;--border:rgba(255,255,255,.08);--text:#e8e8f0;--text2:rgba(255,255,255,.55);--accent:#3D5AFE;--accent2:#FF3CAC;--success:#00E676;--radius:12px}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);scroll-behavior:smooth}\nnav{position:fixed;top:0;width:100%;background:rgba(10,10,26,.9);backdrop-filter:blur(12px);z-index:100;padding:12px 24px;display:flex;align-items:center;justify-content:space-between}\n.section{max-width:1100px;margin:0 auto;padding:80px 16px 40px}\n.features-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px}\n.pricing-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;max-width:900px;margin:0 auto}\n/* TEMPLATE: Hero, feature cards, pricing cards, testimonials, CTA, footer */\n@media(max-width:768px){.features-grid,.pricing-grid{grid-template-columns:1fr}}\n</style>\n</head>\n<body>\n<nav>\n<!-- TEMPLATE: Logo, nav links (Features, Pricing, Testimonials), CTA button -->\n</nav>\n<!-- TEMPLATE: Hero section with headline, subheadline, CTA buttons, product screenshot -->\n<section class="section" id="features">\n<div class="features-grid">\n<!-- TEMPLATE: Feature cards with icon, title, description -->\n</div>\n</section>\n<section class="section" id="pricing">\n<div class="pricing-grid">\n<!-- TEMPLATE: Pricing tiers (Free, Pro, Enterprise) with feature lists -->\n</div>\n</section>\n<!-- TEMPLATE: Testimonials carousel/grid -->\n<!-- TEMPLATE: Final CTA section -->\n<!-- TEMPLATE: Footer with links -->\n<script>\nvar state = { menuOpen: false, billingCycle: \'monthly\' }\nfunction init() { render(); setupNav() }\nfunction setupNav() { /* TEMPLATE: Mobile hamburger, smooth scroll, sticky nav */ }\nfunction render() { /* TEMPLATE: Render pricing toggle, testimonials, scroll animations */ }\n/* TEMPLATE: Pricing toggle (monthly/annual), scroll animations, mobile nav */\ndocument.addEventListener(\'DOMContentLoaded\', init)\n</script>\n</body>\n</html>',
  },
  {
    id: 'calculator',
    name: 'Calculator',
    icon: '\uD83E\uDDEE',
    category: 'tools',
    desc: 'Scientific calculator with history',
    skeleton: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Calculator</title>\n<style>\n:root{--bg:#0a0a1a;--surface:#12122a;--border:rgba(255,255,255,.08);--text:#e8e8f0;--text2:rgba(255,255,255,.55);--accent:#3D5AFE;--accent2:#FF3CAC;--success:#00E676;--radius:12px}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;align-items:center;justify-content:center}\n.calc{max-width:360px;width:100%;padding:16px}\n.display{background:var(--surface);border-radius:var(--radius);padding:20px 16px;margin-bottom:12px;text-align:right}\n.buttons{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}\n/* TEMPLATE: Button styles, display expression/result, history panel */\n@media(min-width:768px){.calc{padding:24px}}\n</style>\n</head>\n<body>\n<div class="calc">\n<div class="display">\n<!-- TEMPLATE: Expression line and result line -->\n</div>\n<div class="buttons">\n<!-- TEMPLATE: Number pad, operators, scientific functions, clear/equals -->\n</div>\n<!-- TEMPLATE: History panel (toggleable) -->\n</div>\n<script>\nvar state = { expression: \'\', result: \'0\', history: [], mode: \'basic\' }\nfunction init() { load(); render() }\nfunction load() { try { var s = localStorage.getItem(\'calc_data\'); if (s) state.history = JSON.parse(s).history || [] } catch(e){} }\nfunction save() { try { localStorage.setItem(\'calc_data\', JSON.stringify({ history: state.history })) } catch(e){} }\nfunction render() { /* TEMPLATE: Update display, buttons, history list */ }\n/* TEMPLATE: Input handling, expression parsing, calculation, keyboard support, history */\ndocument.addEventListener(\'DOMContentLoaded\', init)\n</script>\n</body>\n</html>',
  },
  {
    id: 'budget-tracker',
    name: 'Budget Tracker',
    icon: '\uD83D\uDCB0',
    category: 'productivity',
    desc: 'Expense tracking with categories and charts',
    skeleton: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Budget Tracker</title>\n<style>\n:root{--bg:#0a0a1a;--surface:#12122a;--border:rgba(255,255,255,.08);--text:#e8e8f0;--text2:rgba(255,255,255,.55);--accent:#00E676;--accent2:#FF5252;--warning:#FFD600;--radius:12px}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}\n.container{max-width:700px;width:100%;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:16px}\n/* TEMPLATE: Summary cards, transaction list, add form, category breakdown chart */\n@media(min-width:768px){.container{padding:24px}}\n</style>\n</head>\n<body>\n<div class="container">\n<header style="display:flex;align-items:center;justify-content:space-between">\n<!-- TEMPLATE: Title, month selector, add transaction button -->\n</header>\n<!-- TEMPLATE: Balance summary cards (income, expenses, balance) -->\n<!-- TEMPLATE: Category breakdown (canvas pie chart) -->\n<!-- TEMPLATE: Transaction list with category icons, amounts, dates -->\n<!-- TEMPLATE: Add/edit transaction modal -->\n</div>\n<script>\nvar state = { transactions: [], categories: [\'Food\',\'Transport\',\'Housing\',\'Entertainment\',\'Shopping\',\'Bills\',\'Health\',\'Other\'], month: new Date().getMonth(), year: new Date().getFullYear() }\nfunction init() { load(); render() }\nfunction load() { try { var s = localStorage.getItem(\'budget_data\'); if (s) state = JSON.parse(s) } catch(e){} }\nfunction save() { try { localStorage.setItem(\'budget_data\', JSON.stringify(state)) } catch(e){} }\nfunction render() { /* TEMPLATE: Render summary, chart, transaction list */ }\n/* TEMPLATE: Transaction CRUD, category totals, chart drawing, month navigation, export */\ndocument.addEventListener(\'DOMContentLoaded\', init)\n</script>\n</body>\n</html>',
  },
  {
    id: 'recipe-book',
    name: 'Recipe Book',
    icon: '\uD83C\uDF73',
    category: 'tools',
    desc: 'Recipe collection with search and meal planning',
    skeleton: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Recipe Book</title>\n<style>\n:root{--bg:#0a0a1a;--surface:#12122a;--border:rgba(255,255,255,.08);--text:#e8e8f0;--text2:rgba(255,255,255,.55);--accent:#FF9F43;--accent2:#FF3CAC;--success:#00E676;--radius:12px}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}\n.container{max-width:900px;width:100%;margin:0 auto;padding:16px}\n.recipe-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}\n/* TEMPLATE: Recipe cards, detail view, add form, search bar, category filters */\n@media(max-width:768px){.recipe-grid{grid-template-columns:1fr}}\n</style>\n</head>\n<body>\n<div class="container">\n<header style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">\n<!-- TEMPLATE: Title, search input, add recipe button -->\n</header>\n<!-- TEMPLATE: Category filter tabs -->\n<div class="recipe-grid">\n<!-- TEMPLATE: Recipe cards with image placeholder, title, time, difficulty -->\n</div>\n<!-- TEMPLATE: Recipe detail modal (ingredients, steps, notes) -->\n<!-- TEMPLATE: Add/edit recipe form modal -->\n</div>\n<script>\nvar state = { recipes: [], view: \'grid\', search: \'\', category: \'all\', activeRecipe: null }\nfunction init() { load(); render() }\nfunction load() { try { var s = localStorage.getItem(\'recipe_data\'); if (s) state.recipes = JSON.parse(s).recipes || [] } catch(e){} if (!state.recipes.length) generateDemoData() }\nfunction save() { try { localStorage.setItem(\'recipe_data\', JSON.stringify({ recipes: state.recipes })) } catch(e){} }\nfunction generateDemoData() { /* TEMPLATE: 5-8 demo recipes with ingredients and steps */ }\nfunction render() { /* TEMPLATE: Render recipe grid, search results, detail view */ }\n/* TEMPLATE: Recipe CRUD, search/filter, category management, cooking timer, serving adjuster */\ndocument.addEventListener(\'DOMContentLoaded\', init)\n</script>\n</body>\n</html>',
  },
  {
    id: 'mood-journal',
    name: 'Mood Journal',
    icon: '\uD83C\uDF19',
    category: 'productivity',
    desc: 'Daily mood tracking with emoji ratings and insights',
    skeleton: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Mood Journal</title>\n<style>\n:root{--bg:#0a0a1a;--surface:#12122a;--border:rgba(255,255,255,.08);--text:#e8e8f0;--text2:rgba(255,255,255,.55);--accent:#B44FFF;--accent2:#FF3CAC;--success:#00E676;--radius:12px}\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}\n.container{max-width:600px;width:100%;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:16px}\n/* TEMPLATE: Mood selector, entry card, calendar view, stats/insights */\n@media(min-width:768px){.container{padding:24px}}\n</style>\n</head>\n<body>\n<div class="container">\n<header style="display:flex;align-items:center;justify-content:space-between">\n<!-- TEMPLATE: Title, view toggle (list/calendar), date navigation -->\n</header>\n<!-- TEMPLATE: Today\'s mood entry (emoji picker, note, tags) -->\n<!-- TEMPLATE: Calendar view with mood colors per day -->\n<!-- TEMPLATE: Entry history list -->\n<!-- TEMPLATE: Insights/stats (average mood, streaks, patterns) -->\n</div>\n<script>\nvar state = { entries: [], view: \'list\', month: new Date().getMonth(), year: new Date().getFullYear() }\nfunction init() { load(); render() }\nfunction load() { try { var s = localStorage.getItem(\'mood_data\'); if (s) state.entries = JSON.parse(s).entries || [] } catch(e){} }\nfunction save() { try { localStorage.setItem(\'mood_data\', JSON.stringify({ entries: state.entries })) } catch(e){} }\nfunction render() { /* TEMPLATE: Render mood entry form, calendar, history, insights */ }\n/* TEMPLATE: Mood entry CRUD, calendar rendering, mood stats, tag management, export */\ndocument.addEventListener(\'DOMContentLoaded\', init)\n</script>\n</body>\n</html>',
  },
]
