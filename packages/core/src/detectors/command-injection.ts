/**
 * Command Injection Sink Detector
 *
 * Detects tainted input in shell command execution:
 * - exec(taintedCmd)
 * - execSync(taintedCmd)
 * - spawn('sh', ['-c', taintedCmd])
 * - child_process.exec(taintedCmd)
 *
 * Safe when:
 * - execFile(file, [args]) — no shell, args as array
 * - spawn(cmd, [args]) — no shell, args as array
 * - Command is a literal string (not user-supplied)
 *
 * This is taint analysis — traces user input to command execution sink.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, TaintedSource } from '../ir/types';

/**
 * Detects command injection sinks in a handler function body.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-supplied tainted sources from the handler
 * @returns Array of Sink nodes with kind 'shell-exec'
 */
export function detectCommandInjectionSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[]
): Sink[] {
  const sinks: Sink[] = [];

  // Handler body must be a block statement
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  // Walk the handler body looking for command execution calls
  walkStatements(handlerNode.body.body, (node) => {
    if (node.type === 'CallExpression') {
      const sink = detectCommandExecutionCall(node, taintedSources);
      if (sink) sinks.push(sink);
    }
  });

  return sinks;
}

/**
 * Detects if a CallExpression is a command execution with tainted input.
 *
 * Matches:
 * - exec(taintedCmd)
 * - execSync(taintedCmd)
 * - spawn('sh', ['-c', taintedCmd])
 * - child_process.exec(taintedCmd)
 *
 * Does NOT match:
 * - execFile('cmd', [args]) — safe, no shell
 * - spawn('cmd', [args]) — safe, no shell
 * - exec('hardcoded-command') — safe, not tainted
 */
function detectCommandExecutionCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  
  // Pattern 1: Direct function call (exec, execSync, spawn)
  if (node.callee.type === 'Identifier') {
    return detectDirectCommandCall(node, taintedSources);
  }
  
  // Pattern 2: Member expression (child_process.exec, cp.spawn)
  if (node.callee.type === 'MemberExpression') {
    return detectMemberCommandCall(node, taintedSources);
  }
  
  return null;
}

/**
 * Detects direct command execution calls: exec(), execSync(), spawn()
 */
function detectDirectCommandCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  if (node.callee.type !== 'Identifier') return null;
  
  const funcName = node.callee.name;
  
  // exec() or execSync() — ALWAYS vulnerable if tainted
  if (funcName === 'exec' || funcName === 'execSync') {
    if (node.arguments.length === 0) return null;
    
    const cmdArg = node.arguments[0];
    const taint = findTaintInCommand(cmdArg, taintedSources);
    
    if (taint) {
      return {
        kind: 'shell-exec',
        node: node,
        taintedArg: {
          argIndex: 0,
          taintSource: taint.taintSource,
          node: taint.taintedNode,
        },
      };
    }
  }
  
  // spawn() — vulnerable if using shell
  if (funcName === 'spawn') {
    return detectSpawnWithShell(node, taintedSources);
  }
  
  // execFile() or execFileSync() — check if using safe array form
  if (funcName === 'execFile' || funcName === 'execFileSync') {
    // Safe if second argument is an ArrayExpression
    const secondArg = node.arguments[1];
    if (secondArg?.type === 'ArrayExpression') {
      return null; // Safe — using array form
    }
    
    // If not using array form, might be vulnerable
    // But this is rare, so we'll be conservative and not flag it
    return null;
  }
  
  return null;
}

/**
 * Detects member expression command calls: child_process.exec(), cp.spawn()
 */
function detectMemberCommandCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.property.type !== 'Identifier') return null;
  
  const methodName = node.callee.property.name;
  
  // child_process.exec() or cp.exec()
  if (methodName === 'exec' || methodName === 'execSync') {
    if (node.arguments.length === 0) return null;
    
    const cmdArg = node.arguments[0];
    const taint = findTaintInCommand(cmdArg, taintedSources);
    
    if (taint) {
      return {
        kind: 'shell-exec',
        node: node,
        taintedArg: {
          argIndex: 0,
          taintSource: taint.taintSource,
          node: taint.taintedNode,
        },
      };
    }
  }
  
  // child_process.spawn() or cp.spawn()
  if (methodName === 'spawn') {
    return detectSpawnWithShell(node, taintedSources);
  }
  
  return null;
}

/**
 * Detects spawn() calls that use a shell.
 *
 * Vulnerable patterns:
 * - spawn('sh', ['-c', taintedCmd])
 * - spawn('bash', ['-c', taintedCmd])
 * - spawn(cmd, args, { shell: true }) with tainted cmd or args
 *
 * Safe patterns:
 * - spawn('cmd', [args]) — no shell
 * - spawn('cmd', [taintedArg]) — args as array, no shell interpretation
 */
function detectSpawnWithShell(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  if (node.arguments.length < 2) return null;
  
  const firstArg = node.arguments[0];
  const secondArg = node.arguments[1];
  
  // Pattern 1: spawn('sh', ['-c', taintedCmd])
  if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
    const cmd = firstArg.value;
    
    // Check if it's a shell command
    if (isShellCommand(cmd)) {
      // Check if second arg is array with '-c' flag
      if (secondArg.type === 'ArrayExpression') {
        // Look for '-c' flag
        let hasDashC = false;
        for (const elem of secondArg.elements) {
          if (elem?.type === 'Literal' && elem.value === '-c') {
            hasDashC = true;
            break;
          }
        }
        
        if (hasDashC) {
          // Find tainted command in array elements
          for (let i = 0; i < secondArg.elements.length; i++) {
            const elem = secondArg.elements[i];
            if (!elem) continue;
            
            const taint = findTaintInCommand(elem, taintedSources);
            if (taint) {
              return {
                kind: 'shell-exec',
                node: node,
                taintedArg: {
                  argIndex: 1, // Second argument (the array)
                  taintSource: taint.taintSource,
                  node: taint.taintedNode,
                },
              };
            }
          }
        }
      }
    }
  }
  
  // Pattern 2: spawn(cmd, args, { shell: true })
  if (node.arguments.length >= 3) {
    const thirdArg = node.arguments[2];
    
    if (thirdArg.type === 'ObjectExpression') {
      // Check if shell: true is present
      let hasShellTrue = false;
      
      for (const prop of thirdArg.properties) {
        if (prop.type === 'Property' &&
            prop.key.type === 'Identifier' &&
            prop.key.name === 'shell' &&
            prop.value.type === 'Literal' &&
            prop.value.value === true) {
          hasShellTrue = true;
          break;
        }
      }
      
      if (hasShellTrue) {
        // Check if first or second arg is tainted
        const cmdTaint = findTaintInCommand(firstArg, taintedSources);
        if (cmdTaint) {
          return {
            kind: 'shell-exec',
            node: node,
            taintedArg: {
              argIndex: 0,
              taintSource: cmdTaint.taintSource,
              node: cmdTaint.taintedNode,
            },
          };
        }
        
        // Check args array for tainted values
        if (secondArg.type === 'ArrayExpression') {
          for (const elem of secondArg.elements) {
            if (!elem) continue;
            
            const argTaint = findTaintInCommand(elem, taintedSources);
            if (argTaint) {
              return {
                kind: 'shell-exec',
                node: node,
                taintedArg: {
                  argIndex: 1,
                  taintSource: argTaint.taintSource,
                  node: argTaint.taintedNode,
                },
              };
            }
          }
        }
      }
    }
  }
  
  return null;
}

/**
 * Checks if a command string is a shell.
 */
function isShellCommand(cmd: string): boolean {
  const shells = ['sh', 'bash', 'zsh', 'fish', '/bin/sh', '/bin/bash', '/bin/zsh'];
  return shells.includes(cmd);
}

/**
 * Finds tainted input within a command argument.
 *
 * Handles:
 * - Template literals: `convert ${req.params.filename}`
 * - String concatenation: 'echo ' + req.query.input
 * - Direct tainted values: req.body.cmd
 * - Identifiers: cmd (where cmd = req.body.cmd)
 *
 * @returns Taint info if found, null if command is safe
 */
function findTaintInCommand(
  cmdArg: TSESTree.Node,
  taintedSources: TaintedSource[]
): { taintedNode: TSESTree.Node; taintSource: TaintedSource } | null {
  
  // Pattern 1: Template literal with tainted expression
  // `convert ${req.params.filename}`
  if (cmdArg.type === 'TemplateLiteral') {
    for (const expr of cmdArg.expressions) {
      const taint = traceTaint(expr, taintedSources);
      if (taint) {
        return { taintedNode: expr, taintSource: taint };
      }
    }
  }
  
  // Pattern 2: String concatenation
  // 'echo ' + req.query.input
  if (cmdArg.type === 'BinaryExpression' && cmdArg.operator === '+') {
    const leftTaint = traceTaint(cmdArg.left, taintedSources);
    if (leftTaint) {
      return { taintedNode: cmdArg.left, taintSource: leftTaint };
    }
    
    const rightTaint = traceTaint(cmdArg.right, taintedSources);
    if (rightTaint) {
      return { taintedNode: cmdArg.right, taintSource: rightTaint };
    }
  }
  
  // Pattern 3: Direct tainted identifier or member expression
  const taint = traceTaint(cmdArg, taintedSources);
  if (taint) {
    return { taintedNode: cmdArg, taintSource: taint };
  }
  
  return null;
}

/**
 * Traces a node back to a tainted source.
 *
 * Handles:
 * - Direct identifier reference: `cmd` → traces to `const cmd = req.body.cmd`
 * - Member expression: `req.body.cmd` → matches tainted source directly
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
  if (node.type === 'Identifier') {
    const varName = node.name;
    return taintedSources.find((src) => src.localName === varName) || null;
  }

  // Pattern 2: Direct member expression
  if (node.type === 'MemberExpression') {
    for (const source of taintedSources) {
      if (matchesTaintedMemberExpression(node, source)) {
        return source;
      }
    }
  }

  return null;
}

/**
 * Checks if a MemberExpression matches a tainted source pattern.
 */
function matchesTaintedMemberExpression(
  node: TSESTree.MemberExpression,
  source: TaintedSource
): boolean {
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