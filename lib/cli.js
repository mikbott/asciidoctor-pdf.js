'use strict'

const Lock = require('./lock.js')
const pkg = require('../package.json')
const { Options, Invoker, processor } = require('@asciidoctor/cli')
const chokidar = require('chokidar')
const path = require('path')
const processorLock = new Lock()

const converter = require('./converter.js')
// we look forward to the CLI having Invoker.readFromStdin()
// https://github.com/Mogztter/asciidoctor-pdf.js/pull/158#issuecomment-577788688
const stdin = require('./stdin')

async function convertFiles (files, argv, options, verbose, preview) {
  for (const file of files) {
    if (verbose) {
      console.log(`converting file ${file.contents ? '-' : file.path}`)
    }
    await converter.convert(processor, file, options, argv.timings, argv.watch, preview)
  }
}

class PdfOptions {
  constructor () {
    this.options = new Options()
      .addOption('template-require', {
        describe: 'require the specified template script',
        type: 'string'
      })
      .addOption('watch', {
        alias: 'w',
        default: false,
        describe: 'enable watch mode',
        type: 'boolean'
      })
      .addOption('preview', {
        default: false,
        describe: 'open the otherwise headless browser for inspecting the generated HTML document (before it gets converted to PDF)',
        type: 'boolean'
      })
  }

  parse (argv) {
    return this.options.parse(argv)
  }
}

class PdfInvoker extends Invoker {
  async invoke () {
    const cliOptions = this.options
    const processArgs = cliOptions.argv.slice(2)
    const { args } = cliOptions
    const { verbose, version, files, watch, 'template-require': templateRequireLib, preview } = args
    if (version || (verbose && processArgs.length === 1)) {
      this.showVersion()
      return { exit: true }
    }
    let templates
    if (templateRequireLib) {
      templates = Invoker.requireLibrary(templateRequireLib)
    } else {
      templates = require('./document/document-converter').templates
    }
    converter.registerTemplateConverter(processor, templates)
    Invoker.prepareProcessor(args, processor)
    const asciidoctorOptions = cliOptions.options
    if (cliOptions.stdin) {
      const fictiveInputFile = `${asciidoctorOptions.base_dir || asciidoctorOptions.attributes.docdir || process.cwd()}/asciidoctor-pdf-stdin.adoc`
      stdin.read((data) => {
        const fileObjects = [{
          path: fictiveInputFile,
          contents: data
        }]
        convertFiles(fileObjects, args, asciidoctorOptions, verbose, preview)
      })
      return { exit: false }
    } else if (files && files.length > 0) {
      const fileObjects = files.map(file => ({ path: file }))
      await convertFiles(fileObjects, args, asciidoctorOptions, verbose, preview)
      if (watch) {
        const watchFiles = files.map((file) => {
          const dirname = path.dirname(file)
          const allSubdirPath = path.join(dirname, '**')
          return [
            path.join(allSubdirPath, '*.css'),
            path.join(allSubdirPath, '*.js'),
            path.join(allSubdirPath, '*.adoc'),
            file
          ]
        })
        console.log('Watch mode entered, needs to be manually terminated using Ctrl+C!')
        chokidar.watch(watchFiles, { ignored: /(^|[/\\])\../ }).on('change', async (path) => {
          if (verbose) {
            console.log(`  file changed ${path}`)
          }
          try {
            const hasQueuedEvents = await processorLock.acquire()
            if (!hasQueuedEvents) {
              await convertFiles(files, args, asciidoctorOptions, verbose, preview)
            }
          } finally {
            processorLock.release()
          }
        })
        return { exit: false }
      } else {
        return { exit: true }
      }
    } else {
      this.showHelp()
      return { exit: true }
    }
  }

  version () {
    return `Asciidoctor PDF ${pkg.version} using ${super.version()}`
  }
}

module.exports = {
  PdfOptions: PdfOptions,
  PdfInvoker: PdfInvoker
}
