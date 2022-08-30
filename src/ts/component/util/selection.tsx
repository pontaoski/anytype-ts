import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { getRange } from 'selection-ranges';
import { I, M, focus, keyboard, scrollOnMove, Util } from 'Lib';
import { observer } from 'mobx-react';
import { commonStore, blockStore, menuStore } from 'Store';

interface Props {
	children?: React.ReactNode;
};

const $ = require('jquery');

const THRESHOLD = 10;

const SelectionProvider = observer(class SelectionProvider extends React.Component<Props, {}> {

	_isMounted = false;
	x: number = 0;
	y: number = 0;
	dir: number = 0;
	moved: boolean = false;
	focused: string = '';
	range: any = null;
	nodes: any[] = [];
	top: number = 0;
	containerOffset = null;

	cache: Map<string, any> = new Map();
	ids: Map<string, string[]> = new Map();
	idsOnStart: Map<string, string[]> = new Map();

	isSelecting: boolean = false;
	isSelectionPrevented: boolean = false;
	isClearPrevented: boolean = false;
	
	constructor (props: any) {
		super(props);
		
		this.onMouseDown = this.onMouseDown.bind(this);
		this.onMouseMove = this.onMouseMove.bind(this);
		this.onMouseUp = this.onMouseUp.bind(this);
	};

	render () {
		const children = this.injectProps(this.props.children);
		return (
			<div id="selection" className="selection" onMouseDown={this.onMouseDown}>
				<div id="selection-rect" />
				{children}
			</div>
		);
	};
	
	componentDidMount () {
		const isPopup = keyboard.isPopup();

		this._isMounted = true;
		this.unbind();

		Util.getScrollContainer(isPopup).on('scroll.selection', (e: any) => { this.onScroll(e); });
	};
	
	componentWillUnmount () {
		this._isMounted = false;
		this.unbind();
	};

	unbind () {
		this.unbindMouse();
		this.unbindKeyboard();
	};
	
	unbindMouse () {
		$(window).off('mousemove.selection mouseup.selection');
	};
	
	unbindKeyboard () {
		const isPopup = keyboard.isPopup();

		$(window).off('keydown.selection keyup.selection');
		Util.getScrollContainer(isPopup).off('scroll.selection');
	};

	preventSelect (v: boolean) {
		this.isSelectionPrevented = v;
	};
	
	preventClear (v: boolean) {
		this.isClearPrevented = v;
	};
	
	scrollToElement (id: string, dir: number) {
		const isPopup = keyboard.isPopup();

		if (dir > 0) {
			focus.scroll(isPopup, id);
		} else {
			const node = $('.focusable.c' + id);
			if (!node.length) {
				return;
			};

			const container = Util.getScrollContainer(isPopup);
			const no = node.offset().top;
			const nh = node.outerHeight();
			const st = container.scrollTop();
			const hh = Util.sizeHeader();
			const y = isPopup ? (no - container.offset().top + st) : no;

			if (y <= st + hh) {
				container.scrollTop(y - nh - hh);
			};
		};
	};
	
	onScroll (e: any) {
		if (!this.isSelecting || !this.moved) {
			return;
		};

		const isPopup = keyboard.isPopup();
		const top = Util.getScrollContainer(isPopup).scrollTop();
		const d = top > this.top ? 1 : -1;

		let { x, y } = keyboard.mouse.page;
		if (!isPopup) {
			y += Math.abs(top - this.top) * d;
		};

		const rect = this.getRect(x, y);
		if ((rect.width < THRESHOLD) && (rect.height < THRESHOLD)) {
			return;
		};

		this.nodes.forEach(it => this.cacheRect(it));

		this.checkNodes({ ...e, pageX: x, pageY: y });
		this.drawRect(rect);
		this.renderSelection();

		scrollOnMove.onMouseMove(keyboard.mouse.client.x, keyboard.mouse.client.y);
		this.moved = true;
	};
	
	onMouseDown (e: any) {
		if (e.button || !this._isMounted || menuStore.isOpen()) {
			return;
		};
		
		if (this.isSelectionPrevented) {
			this.hide();
			return;
		};
		
		const isPopup = keyboard.isPopup();
		const { focused } = focus.state;
		const win = $(window);
		const node = $(ReactDOM.findDOMNode(this));
		const nodes = this.getPageContainer().find('.selectable');
		
		node.find('#selection-rect').css({ transform: 'translate3d(0px, 0px, 0px)', width: 0, height: 0 }).show();
		
		this.x = e.pageX;
		this.y = e.pageY;
		this.moved = false;
		this.focused = focused;
		this.isSelecting = true;
		this.top = Util.getScrollContainer(isPopup).scrollTop();
		this.cache.clear();
		this.idsOnStart = new Map(this.ids);

		if (isPopup) {
			const popupContainer = $('#popupPage-innerWrap');
			if (popupContainer.length) {
				this.containerOffset = popupContainer.offset();
				this.x -= this.containerOffset.left;
				this.y -= this.containerOffset.top - this.top;
			};
		};

		keyboard.disablePreview(true);

		nodes.each((i: number, item: any) => {
			item = $(item);

			const node = {
				id: item.attr('data-id'),
				type: item.attr('data-type'),
				obj: item,
			};

			this.nodes.push(node);
			this.cacheRect(node);
		});

		if (keyboard.isShift()) {
			let target = $(e.target).closest('.selectable');
			let type = target.attr('data-type');
			let id = target.attr('data-id');
			let ids = this.get(type);

			if (!ids.length && (id != focused)) {
				this.set(type, ids.concat([ focused ]));
			};
		};
		
		scrollOnMove.onMouseDown(e, isPopup);
		this.unbindMouse();

		win.on(`mousemove.selection`, (e: any) => { this.onMouseMove(e); });
		win.on(`blur.selection mouseup.selection`, (e: any) => { this.onMouseUp(e); });
	};
	
	onMouseMove (e: any) {
		if (!this._isMounted) {
			return;
		};
		
		if (this.isSelectionPrevented) {
			this.hide();
			return;
		};
		
		const isPopup = keyboard.isPopup();
		const rect = this.getRect(e.pageX, e.pageY);

		if ((rect.width < THRESHOLD) && (rect.height < THRESHOLD)) {
			return;
		};

		this.top = Util.getScrollContainer(isPopup).scrollTop();
		this.checkNodes(e);
		this.drawRect(rect);
		
		scrollOnMove.onMouseMove(e.clientX, e.clientY);
		this.moved = true;
	};
	
	onMouseUp (e: any) {
		if (!this._isMounted) {
			return;
		};

		if (!this.moved) {
			if (!keyboard.isShift() && !keyboard.isAlt() && !(keyboard.isCtrl() || keyboard.isMeta())) {
				if (!this.isClearPrevented) {
					this.initIds();
				};
				this.renderSelection();
			} else {
				this.checkNodes(e);
				
				const ids = this.get(I.SelectType.Block, true);
				const target = $(e.target).closest('.selectable');
				const id = target.attr('data-id');
				const type = target.attr('data-type');
				
				if (target.length && keyboard.isShift() && ids.length && (type == I.SelectType.Block)) {
					const rootId = keyboard.getRootId();
					const first = ids.length ? ids[0] : this.focused;
					const tree = blockStore.getTree(rootId, blockStore.getBlocks(rootId));
					const list = blockStore.unwrapTree(tree);
					const idxStart = list.findIndex(it => it.id == first);
					const idxEnd = list.findIndex(it => it.id == id);
					const start = idxStart < idxEnd ? idxStart : idxEnd;
					const end = idxStart < idxEnd ? idxEnd : idxStart;
					const slice = list.slice(start, end + 1).
						map(it => new M.Block(it)).
						filter(it => it.isSelectable()).
						map(it => it.id);

					this.set(type, ids.concat(slice));
				};
			};
		};
		
		scrollOnMove.onMouseUp(e);

		this.checkSelected(I.SelectType.Block);
		this.clearState();
	};

	initIds () {
		for (let i in I.SelectType) {
			this.ids.set(I.SelectType[i], []);
		};
	};

	clearState () {
		keyboard.disablePreview(false);
		this.hide();

		this.cache.clear();
		this.focused = '';
		this.range = null;
		this.isSelecting = false;
		this.nodes = [];
	};

	drawRect (rect: any) {
		const { config } = commonStore;

		if (!config.debug.ui) {
			return;
		};

		const node = $(ReactDOM.findDOMNode(this));
		const el = node.find('#selection-rect');

		el.css({ 
			transform: `translate3d(${rect.x + 10}px, ${rect.y + 10}px, 0px)`,
			width: rect.width - 10, 
			height: rect.height - 10,
		});
	};
	
	getRect (x: number, y: number) {
		const isPopup = keyboard.isPopup();
		
		if (isPopup && this.containerOffset) {
			const top = Util.getScrollContainer(isPopup).scrollTop();
			x -= this.containerOffset.left;
			y -= this.containerOffset.top - top;
		};

		return {
			x: Math.min(this.x, x),
			y: Math.min(this.y, y),
			width: Math.abs(x - this.x) - 10,
			height: Math.abs(y - this.y) - 10
		};
	};
	
	cacheRect (node: any) {
		let cached = this.cache.get(node.id);
		if (cached) {
			return cached;
		};

		const isPopup = keyboard.isPopup();
		const offset = node.obj.offset();
		const rect = node.obj.get(0).getBoundingClientRect() as DOMRect;
		
		let x = offset.left;
		let y = offset.top;

		if (isPopup && this.containerOffset) {
			const top = Util.getScrollContainer(isPopup).scrollTop();
			x -= this.containerOffset.left;
			y -= this.containerOffset.top - top;
		};

		cached = { x, y, width: rect.width, height: rect.height };

		this.cache.set(node.id, cached);
		return cached;
	};
	
	checkEachNode (e: any, rect: any, node: any) {
		const { id, type } = node;
		if (!id || !type) {
			return;
		};
			
		const cached = this.cacheRect(node);
		if (!cached || !Util.rectsCollide(rect, cached)) {
			return;
		};

		let ids = this.get(type, false);

		if (keyboard.isCtrl() || keyboard.isMeta()) {
			const idsOnStart = this.idsOnStart.get(type) || [];
			if (idsOnStart.includes(id)) {
				ids = ids.filter(it => it != id);
			} else {
				ids.push(id);
			};
		} else
		if (keyboard.isAlt()) {
			ids = ids.filter(it => it != id);
		} else {
			ids.push(id);
		};

		this.ids.set(type, ids);
	};
	
	checkNodes (e: any) {
		if (!this._isMounted) {
			return
		};
		
		const { focused, range } = focus.state;
		const rect = Util.objectCopy(this.getRect(e.pageX, e.pageY));

		if (!keyboard.isShift() && !keyboard.isAlt() && !(keyboard.isCtrl() || keyboard.isMeta())) {
			this.initIds();
		};

		this.nodes.forEach((item: any) => { 
			this.checkEachNode(e, rect, item);
		});
		
		this.renderSelection();

		const selected = $('.selectable.isSelectionSelected');
		const length = selected.length;

		if (!length) {
			return;
		};

		if ((length <= 1) && !(keyboard.isCtrl() || keyboard.isMeta())) {
			const value = selected.find('.value');
			if (!value.length) {
				return;
			};

			const el = value.get(0) as Element;
			const range = getRange(el); 
			
			if (!this.range) {
				this.focused = selected.attr('data-id');
				this.range = range;
			};

			if (this.range) {
				if (this.range.end) {
					this.initIds();
					this.renderSelection();
				};
				
				if (!range) {
					focus.set(this.focused, { from: this.range.start, to: this.range.end });
					focus.apply();
				};
			};
		} else {
			if (focused && range.to) {
				focus.clear(false);
			};
			
			keyboard.setFocus(false);
			window.getSelection().empty();
			window.focus();
		};
	};
	
	hide () {
		if (!this._isMounted) {
			return
		};
		
		const node = $(ReactDOM.findDOMNode(this));
		const el = node.find('#selection-rect');
		
		el.hide();
		this.unbindMouse();
	};
	
	clear (force: false) {
		if (!this._isMounted || (this.isClearPrevented && !force)) {
			return;
		};

		if (force) {
			this.preventClear(false);
		};

		this.initIds();
		this.renderSelection();
		this.clearState();
	};
	
	set (type: I.SelectType, ids: string[]) {
		this.ids.set(type, Util.arrayUnique(ids || []));
		this.renderSelection();
	};
	
	get (type: I.SelectType, withChildren?: boolean): any {
		let ids = Util.objectCopy(this.ids.get(type) || []);

		if (type == I.SelectType.Block) {
			if (withChildren) {
				ids.forEach(id => this.getChildrenIds(id, ids));
			} else {
				let childrenIds = [];				
				ids.forEach(id => this.getChildrenIds(id, childrenIds));
				ids = ids.filter(it => !childrenIds.includes(it));
			};
		};

		return ids;
	};

	checkSelected (type: I.SelectType) {
		let ids = this.get(type, true);
		if (!ids.length) {
			return;
		};

		focus.clear(true);
		menuStore.close('blockContext');
	};

	getChildrenIds (id: string, ids: string[]) {
		const rootId = keyboard.getRootId();
		const block = blockStore.getLeaf(rootId, id);
		
		if (!block || block.isTable()) {
			return;
		};
		
		const childrenIds = blockStore.getChildrenIds(rootId, id);
		if (!childrenIds.length) {
			return;
		};

		for (let childId of childrenIds) {
			ids.push(childId);
			this.getChildrenIds(childId, ids);
		};
	};

	getPageContainer () {
		return $(Util.getCellContainer(keyboard.isPopup() ? 'popup' : 'page'));
	};

	renderSelection () {
		if (!this._isMounted) {
			return;
		};

		$('.isSelectionSelected').removeClass('isSelectionSelected');

		for (let i in I.SelectType) {
			const type = I.SelectType[i];
			const ids = this.get(type);

			for (let id of ids) {
				$(`#selectable-${id}`).addClass('isSelectionSelected');

				if (type == I.SelectType.Block) {
					$(`#block-${id}`).addClass('isSelectionSelected');
					$(`#block-children-${id} .block`).addClass('isSelectionSelected');
				};
			};
		};
	};
	
	injectProps (children: any) {
		keyboard.setSelection(this);

		return React.Children.map(children, (child: any) => {
			if (!child) {
				return;
			};

			let props = child.props || {};
			let children = props.children;
			let dataset = props.dataset || {};
			
			if (children) {
				child = React.cloneElement(child, { children: this.injectProps(children) });
			};
			
			dataset.selection = this;
			return React.cloneElement(child, { dataset: dataset });
		});
	};
	
});

export default SelectionProvider;