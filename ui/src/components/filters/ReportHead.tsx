import type { ReactNode } from 'react';
import type { Dimension } from '../../api/types';
import type { FilterTab } from '../../scopeSides';
import { ReportPickers } from './ReportPickers';
import { RowsMenu } from './RowsMenu';

/** A report panel's head: title and summary, then the tab's own controls, the other-side and ability pickers and the Rows menu. */
export function ReportHead(props: { tab: FilterTab; id: string; title: ReactNode; summary?: ReactNode; tools?: ReactNode; group?: Dimension }) {
  const { tab, id, title, summary, tools, group } = props;
  return (
    <div className="panel-head report-head">
      <div className="report-head-title">
        <h2 className="h2" id={id}>
          {title}
        </h2>
        {summary}
      </div>
      <div className="report-head-tools">
        {tools}
        <ReportPickers tab={tab} />
        {group && <RowsMenu tab={tab} group={group} />}
      </div>
    </div>
  );
}
