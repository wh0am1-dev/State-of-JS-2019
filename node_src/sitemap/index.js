const fs = require('fs')
const { findIndex, findLastIndex, omit, template } = require('lodash')
const yaml = require('js-yaml')
pick = require('lodash/pick')

const rawPageTemplates = fs.readFileSync('./config/page_templates.yml', 'utf8')
const rawBlockTemplates = fs.readFileSync('./config/block_templates.yml', 'utf8')

const applyTemplate = (config, templateName, rawTemplates, parent) => {
    // defines all available variables to be injected
    // at build time in the GraphQL queries
    const variables = {
        id: config.id,
        ...(config.variables || {})
    }
    if (parent) {
        variables.parentId = parent.id
    }
    // Inject variables in raw yaml templates
    const interpolatedTemplates = template(rawTemplates)(variables)
    // Parse interpolated templates, meaning with built time variables replaced
    const templates = yaml.safeLoad(interpolatedTemplates)
    // pick the corresponding template
    const templateObject = templates[templateName] || {}

    return { ...templateObject, ...config }
}

exports.pageFromConfig = (stack, config, parent) => {

    // if template has been provided, apply it
    if (config.template) {
        config = applyTemplate(config, config.template, rawPageTemplates, parent)
    }

    const pagePath = config.path || `/${config.id}`
    const page = {
        ...config,
        path: parent === undefined ? pagePath : `${parent.path.replace(/\/$/, '')}${pagePath}`,
        is_hidden: !!config.is_hidden,
        children: []
    }
    // if page has no defaultBlockType, get it from parent
    if (!page.defaultBlockType) {
        page.defaultBlockType = (parent && parent.defaultBlockType) || 'default'
    }

    if (!page.path.endsWith('/')) {
        page.path = `${page.path}/`
    }

    if (Array.isArray(page.blocks)) {
        page.blocks = page.blocks.map(block => {
            // if template has been provided, apply it

            if (block.template) {
                block = applyTemplate(block, block.template, rawBlockTemplates, page)
            }

            // if block type is missing, get it from parent
            if (!block.type) {
                block.type = page.defaultBlockType
            }

            return {
                ...block,
                path: `${page.path}${block.id}/`
            }
        })
    }

    if (parent === undefined) {
        stack.hierarchy.push(page)
    }
    stack.flat.push(page)

    if (Array.isArray(config.children)) {
        config.children.forEach(child => {
            page.children.push(exports.pageFromConfig(stack, child, page))
        })
    }

    return page
}

let computedSitemap = null

exports.computeSitemap = async rawSitemap => {
    if (computedSitemap !== null) {
        return computedSitemap
    }

    const stack = {
        flat: [],
        hierarchy: []
    }

    rawSitemap.forEach(item => {
        exports.pageFromConfig(stack, item)
    })

    // assign prev/next page using flat pages
    stack.flat.forEach(page => {
        const index = findIndex(stack.flat, p => p.path === page.path)
        const previous = pick(stack.flat[index - 1], ['id', 'path'])
        if (previous !== undefined && previous.is_hidden !== true) {
            page.previous = omit(previous, ['is_hidden', 'previous', 'next', 'children', 'blocks'])
        }

        const lastIndex = findLastIndex(stack.flat, p => p.path === page.path)
        const next = pick(stack.flat[lastIndex + 1], ['id', 'path'])
        if (next !== undefined && next.is_hidden !== true) {
            page.next = omit(next, ['is_hidden', 'previous', 'next', 'children', 'blocks'])
        }
    })

    const now = new Date()
    const sitemapContent = [
        `###################################################################`,
        `# DO NOT EDIT`,
        `###################################################################`,
        `# this file was generated by \`gatsby-node.js\``,
        `# please edit \`raw_sitemap.yaml\` instead.`,
        `# generated on: ${now.toISOString()}`,
        `###################################################################`,
        yaml.dump(stack.hierarchy, { noRefs: true })
    ].join('\n')
    await fs.writeFileSync('./config/sitemap.yml', sitemapContent)

    return stack
}
