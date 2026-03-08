import * as vscode from 'vscode';
import { NexTermVault } from '@nexterm/core';

type ServerMeta = ReturnType<NexTermVault['getAllServersMeta']>[number];

export class ServerTreeProvider implements vscode.TreeDataProvider<ServerTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ServerTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private vault: NexTermVault,
    private activeConnections: Set<string>,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ServerTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ServerTreeItem[] {
    return this.vault.getAllServersMeta().map(s =>
      new ServerTreeItem(s, this.activeConnections.has(s.id))
    );
  }
}

export class ServerTreeItem extends vscode.TreeItem {
  serverId: string;

  constructor(server: ServerMeta, isConnected: boolean) {
    super(server.name, vscode.TreeItemCollapsibleState.None);
    this.serverId = server.id;

    const status = isConnected ? 'connected' : 'offline';
    this.description = `${server.username}@${server.host}:${server.port}`;
    this.tooltip = `Status: ${status} | Auth: ${server.authType}`;

    this.iconPath = isConnected
      ? new vscode.ThemeIcon('vm-active', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('server');

    this.contextValue = 'nexterm-server';
    this.command = {
      command: 'nexterm.connect',
      title: 'Connect',
      arguments: [this],
    };
  }
}
