// Styles
import './styles/base.css'
import './styles/screens.css'
import './styles/components.css'
import './styles/pipeline.css'
import './styles/chat.css'

// Install key guard (must be first JS import)
import './lib/key-guard.js'

// Import and run app
import { init } from './app.js'

init()
