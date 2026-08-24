import { Chart as ChartJS } from 'chart.js'

export function applyChartDefaults() {
  if (ChartJS.defaults.plugins.legend) {
    ChartJS.defaults.plugins.legend.display = false
  }
  if (ChartJS.defaults.plugins.tooltip) {
    ChartJS.defaults.plugins.tooltip.enabled = true
  }
  ChartJS.defaults.color = '#A1A1AA'
  ChartJS.defaults.borderColor = 'rgba(255,255,255,0.04)'
  ChartJS.defaults.font.family = 'inherit'
  ChartJS.defaults.animation = false
  ChartJS.defaults.layout.padding = 8

  if (ChartJS.defaults.elements.bar) {
    ChartJS.defaults.elements.bar.borderRadius = 6
  }
  if (ChartJS.defaults.elements.line) {
    ChartJS.defaults.elements.line.borderCapStyle = 'round'
    ChartJS.defaults.elements.line.borderJoinStyle = 'round'
  }
}
