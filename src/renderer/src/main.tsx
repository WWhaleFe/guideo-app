import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Remote from './screens/Remote'
import RegionSelect from './screens/RegionSelect'
import './styles.css'

function Root(): JSX.Element {
  const hash = window.location.hash.replace('#', '')
  if (hash === 'remote') return <Remote />
  if (hash === 'region') return <RegionSelect />
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
