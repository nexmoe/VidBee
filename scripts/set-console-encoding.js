/**
 * 设置控制台编码为 UTF-8，解决中文乱码问题
 * 这个脚本在 Windows 上设置控制台代码页为 UTF-8
 */

const { exec } = require('node:child_process')
const os = require('node:os')

if (os.platform() === 'win32') {
  console.log('Setting console encoding to UTF-8...')

  // 设置控制台代码页为 UTF-8 (65001)
  exec('chcp 65001', (error, stdout, stderr) => {
    if (error) {
      console.warn('Failed to set console code page:', error)
      return
    }

    if (stderr) {
      console.warn('Console code page setting warning:', stderr)
    }

    console.log('Console encoding set to UTF-8')
    console.log('Output:', stdout)
  })
} else {
  console.log('Not on Windows, no console encoding change needed')
}
