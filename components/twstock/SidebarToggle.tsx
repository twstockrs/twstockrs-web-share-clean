import type {Ref} from 'react';
import {PanelRightClose,PanelRightOpen} from 'lucide-react';

export default function SidebarToggle({collapsed,onToggle,buttonRef}:{collapsed:boolean;onToggle:()=>void;buttonRef?:Ref<HTMLButtonElement>}){
 return <button ref={buttonRef} type="button" className="sidebar-toggle" aria-label={collapsed?'展開側欄':'收合側欄'} title={collapsed?'展開清單與明細':'收合側欄，放大圖表'} aria-expanded={!collapsed} aria-controls="workspace-sidebar" onClick={onToggle}>{collapsed?<PanelRightOpen size={16}/>:<PanelRightClose size={16}/>} {collapsed&&<span>清單</span>}</button>;
}
