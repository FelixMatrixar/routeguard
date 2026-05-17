/**
 * SSRF (Server-Side Request Forgery) Sink Detector
 *
 * Detects tainted URLs in outbound HTTP requests:
 * - axios.get(taintedUrl)
 * - fetch(taintedUrl)
 * - http.request({ hostname: taintedHost })
 * - got(taintedUrl)
 * - needle.get(taintedUrl)
 *
 * Safe when:
 * - URL passes through allowlist validation before the call
 * - URL is a literal string (not user-supplied)
 * - URL is from a trusted source (config, database, etc.)
 *
 * This is taint analysis — traces user input to HTTP request sink.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, TaintedSource } from '../ir/types';

/**
 * Detects SSRF sinks in a handler function body.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-supplied tainted sources from the handler
 * @returns Array of Sink nodes with kind 'outbound-url'
 */
export function detectSSRFSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[]
): Sink[] {
  const sinks: Sink[] = [];

  // Handler body must be a block statement
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  // Walk the handler body looking for HTTP request calls
  walkStatements(handlerNode.body.body, (node) => {
    if (node.type === 'CallExpression') {
      const sink = detectHTTPRequestCall(node, taintedSources);
      if (sink) sinks.push(sink);
    }
  });

  return sinks;
}

/**
 * Detects HTTP request calls with tainted URL.
 *
 * Patterns:
 * 1. axios.get/post/put/delete/patch(taintedUrl)
 * 2. fetch(taintedUrl)
 * 3. http.request({ hostname: taintedHost })
 * 4. https.request(taintedUrl)
 * 5. got(taintedUrl)
 * 6. needle.get(taintedUrl)
 * 7. node-fetch(taintedUrl)
 */
function detectHTTPRequestCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  
  // Pattern 1: axios.get/post/etc, http.request, needle.get
  if (node.callee.type === 'MemberExpression') {
    return detectMemberExpressionRequest(node, taintedSources);
  }
  
  // Pattern 2: fetch(url), got(url), nodeFetch(url)
  if (node.callee.type === 'Identifier') {
    return detectIdentifierRequest(node, taintedSources);
  }
  
  return null;
}

/**
 * Detects member expression HTTP requests.
 *
 * Patterns:
 * - axios.get(url)
 * - axios.post(url, data)
 * - axios({ url: taintedUrl })
 * - http.request({ hostname: taintedHost })
 * - https.request(options)
 * - got.get(url)
 * - needle.get(url)
 */
function detectMemberExpressionRequest(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.object.type !== 'Identifier') return null;
  if (node.callee.property.type !== 'Identifier') return null;
  
  const objName = node.callee.object.name;
  const methodName = node.callee.property.name;
  
  // Check if it's an HTTP client library
  const httpLibraries = ['axios', 'http', 'https', 'got', 'needle', 'superagent', 'request'];
  if (!httpLibraries.includes(objName)) return null;
  
  // HTTP methods
  const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request'];
  if (!httpMethods.includes(methodName)) return null;
  
  // Pattern 1: axios.get(url) — URL is first argument
  if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(methodName)) {
    if (node.arguments.length === 0) return null;
    
    const urlArg = node.arguments[0];
    const taint = traceTaint(urlArg, taintedSources);
    
    if (taint) {
      return {
        kind: 'outbound-url',
        node: node,
        taintedArg: {
          argIndex: 0,
          taintSource: taint,
          node: urlArg,
        },
      };
    }
  }
  
  // Pattern 2: http.request({ hostname: taintedHost })
  if (methodName === 'request') {
    if (node.arguments.length === 0) return null;
    
    const optionsArg = node.arguments[0];
    
    // Check if first arg is an object with tainted hostname/host/url
    if (optionsArg.type === 'ObjectExpression') {
      for (const prop of optionsArg.properties) {
        if (prop.type !== 'Property') continue;
        if (prop.key.type !== 'Identifier') continue;
        
        const keyName = prop.key.name;
        
        // Check for URL-related properties
        if (['hostname', 'host', 'url', 'uri', 'href'].includes(keyName)) {
          const taint = traceTaint(prop.value, taintedSources);
          
          if (taint) {
            return {
              kind: 'outbound-url',
              node: node,
              taintedArg: {
                argIndex: 0,
                taintSource: taint,
                node: prop.value,
              },
            };
          }
        }
      }
    }
    
    // Check if first arg is a tainted URL string
    const taint = traceTaint(optionsArg, taintedSources);
    if (taint) {
      return {
        kind: 'outbound-url',
        node: node,
        taintedArg: {
          argIndex: 0,
          taintSource: taint,
          node: optionsArg,
        },
      };
    }
  }
  
  return null;
}

/**
 * Detects identifier-based HTTP requests.
 *
 * Patterns:
 * - fetch(url)
 * - fetch(url, options)
 * - got(url)
 * - nodeFetch(url)
 */
function detectIdentifierRequest(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  if (node.callee.type !== 'Identifier') return null;
  
  const funcName = node.callee.name;
  
  // Check if it's a fetch-style function
  const fetchFunctions = ['fetch', 'got', 'nodeFetch', 'request'];
  if (!fetchFunctions.includes(funcName)) return null;
  
  // URL is first argument
  if (node.arguments.length === 0) return null;
  
  const urlArg = node.arguments[0];
  const taint = traceTaint(urlArg, taintedSources);
  
  if (taint) {
    return {
      kind: 'outbound-url',
      node: node,
      taintedArg: {
        argIndex: 0,
        taintSource: taint,
        node: urlArg,
      },
    };
  }
  
  return null;
}

/**
 * Traces a node back to a tainted source.
 *
 * Handles:
 * - Direct identifier: url → const url = req.query.url
 * - Member expression: req.query.url
 * - Template literal: `https://api.com/${req.params.endpoint}`
 * - String concatenation: 'https://api.com/' + req.query.path
 *
 * Note: This does NOT detect allowlist validation. That would require
 * control flow analysis to check if the URL was validated before use.
 * For v1, we flag all tainted URLs and suggest allowlist validation.
 *
 * @param node - The node to trace
 * @param taintedSources - Known tainted sources in the handler
 * @returns The tainted source if found, null otherwise
 */
function traceTaint(
  node: TSESTree.Node,
  taintedSources: TaintedSource[]
): TaintedSource | null {
  
  // Pattern 1: Direct identifier reference
  // axios.get(url) where url = req.query.url
  if (node.type === 'Identifier') {
    const varName = node.name;
    return taintedSources.find((src) => src.localName === varName) || null;
  }
  
  // Pattern 2: Direct member expression
  // axios.get(req.query.url)
  if (node.type === 'MemberExpression') {
    for (const source of taintedSources) {
      if (matchesTaintedMemberExpression(node, source)) {
        return source;
      }
    }
  }
  
  // Pattern 3: Template literal with tainted parts
  // axios.get(`https://api.com/${req.params.endpoint}`)
  if (node.type === 'TemplateLiteral') {
    for (const expr of node.expressions) {
      const taint = traceTaint(expr, taintedSources);
      if (taint) return taint;
    }
  }
  
  // Pattern 4: Binary expression (string concatenation)
  // axios.get('https://api.com/' + req.query.path)
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const leftTaint = traceTaint(node.left, taintedSources);
    if (leftTaint) return leftTaint;
    
    const rightTaint = traceTaint(node.right, taintedSources);
    if (rightTaint) return rightTaint;
  }
  
  return null;
}

/**
 * Checks if a MemberExpression matches a tainted source pattern.
 *
 * Example:
 * - MemberExpression: req.query.url
 * - TaintedSource: { localName: 'url', requestKey: 'url', kind: 'query-param' }
 * - Match: true (both refer to req.query.url)
 */
function matchesTaintedMemberExpression(
  node: TSESTree.MemberExpression,
  source: TaintedSource
): boolean {
  // Check if the property name matches the request key
  if (node.property.type === 'Identifier') {
    return node.property.name === source.requestKey;
  }
  return false;
}

/**
 * Recursively walks statements and calls visitor for each node.
 */
function walkStatements(
  statements: TSESTree.Statement[],
  visitor: (node: TSESTree.Node) => void
): void {
  for (const stmt of statements) {
    walkNode(stmt, visitor);
  }
}

/**
 * Recursively walks a single node and calls visitor.
 */
function walkNode(node: TSESTree.Node, visitor: (node: TSESTree.Node) => void): void {
  visitor(node);

  switch (node.type) {
    case 'ExpressionStatement':
      walkNode(node.expression, visitor);
      break;

    case 'VariableDeclaration':
      for (const decl of node.declarations) {
        if (decl.init) walkNode(decl.init, visitor);
      }
      break;

    case 'IfStatement':
      walkNode(node.test, visitor);
      walkNode(node.consequent, visitor);
      if (node.alternate) walkNode(node.alternate, visitor);
      break;

    case 'BlockStatement':
      walkStatements(node.body, visitor);
      break;

    case 'ReturnStatement':
      if (node.argument) walkNode(node.argument, visitor);
      break;

    case 'CallExpression':
      for (const arg of node.arguments) {
        walkNode(arg, visitor);
      }
      break;

    case 'AwaitExpression':
      walkNode(node.argument, visitor);
      break;

    case 'MemberExpression':
      walkNode(node.object, visitor);
      if (node.property.type !== 'Literal') {
        walkNode(node.property, visitor);
      }
      break;

    case 'BinaryExpression':
    case 'LogicalExpression':
      walkNode(node.left, visitor);
      walkNode(node.right, visitor);
      break;

    case 'ConditionalExpression':
      walkNode(node.test, visitor);
      walkNode(node.consequent, visitor);
      walkNode(node.alternate, visitor);
      break;

    case 'ArrayExpression':
      for (const elem of node.elements) {
        if (elem) walkNode(elem, visitor);
      }
      break;

    case 'ObjectExpression':
      for (const prop of node.properties) {
        if (prop.type === 'Property') {
          walkNode(prop.value, visitor);
        }
      }
      break;

    case 'TemplateLiteral':
      for (const expr of node.expressions) {
        walkNode(expr, visitor);
      }
      break;

    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      if (node.body.type === 'BlockStatement') {
        walkStatements(node.body.body, visitor);
      } else {
        walkNode(node.body, visitor);
      }
      break;

    case 'TryStatement':
      walkNode(node.block, visitor);
      if (node.handler) walkNode(node.handler.body, visitor);
      if (node.finalizer) walkNode(node.finalizer, visitor);
      break;

    case 'ForStatement':
      if (node.init) walkNode(node.init, visitor);
      if (node.test) walkNode(node.test, visitor);
      if (node.update) walkNode(node.update, visitor);
      walkNode(node.body, visitor);
      break;

    case 'WhileStatement':
    case 'DoWhileStatement':
      walkNode(node.test, visitor);
      walkNode(node.body, visitor);
      break;

    case 'ForInStatement':
    case 'ForOfStatement':
      walkNode(node.left, visitor);
      walkNode(node.right, visitor);
      walkNode(node.body, visitor);
      break;

    case 'SwitchStatement':
      walkNode(node.discriminant, visitor);
      for (const caseNode of node.cases) {
        for (const stmt of caseNode.consequent) {
          walkNode(stmt, visitor);
        }
      }
      break;

    case 'Identifier':
    case 'Literal':
    case 'ThisExpression':
    case 'BreakStatement':
    case 'ContinueStatement':
      break;

    default:
      for (const key in node) {
        if (key === 'parent' || key === 'loc' || key === 'range') continue;

        const value = (node as any)[key];
        if (value && typeof value === 'object') {
          if (Array.isArray(value)) {
            for (const item of value) {
              if (item && typeof item === 'object' && item.type) {
                walkNode(item, visitor);
              }
            }
          } else if (value.type) {
            walkNode(value, visitor);
          }
        }
      }
  }
}

// Made with Bob