from agents import TracingProcessor
import logging
from datetime import datetime, timedelta
import json

logger = logging.getLogger(__name__)

class AgentTurnTraceProcessor(TracingProcessor):
    """Custom trace processor to print detailed information about agent turns."""
    
    def __init__(self):
        self.span_depth = {}  # Track depth of each span
        self.handoff_chain = []  # Track sequence of agent handoffs
        self.message_flow = []  # Track message flow between agents
        
    def _get_indent_level(self, span):
        """Calculate indent level based on parent_id chain."""
        depth = 0
        current_id = span.parent_id
        while current_id:
            depth += 1
            current_id = self.span_depth.get(current_id)
        return depth

    def _format_time(self, timestamp_str):
        """Convert ISO timestamp string to formatted time string in IST timezone."""
        try:
            dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            # Add 5 hours and 30 minutes for IST timezone
            dt = dt + timedelta(hours=5, minutes=30)
            return dt.strftime("%H:%M:%S.%f")[:-3]
        except (ValueError, AttributeError):
            return "00:00:00.000"

    def _calculate_duration(self, start_str, end_str):
        """Calculate duration between two ISO timestamp strings in seconds."""
        try:
            start = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
            end = datetime.fromisoformat(end_str.replace('Z', '+00:00'))
            return (end - start).total_seconds()
        except (ValueError, AttributeError):
            return 0.0

    def _get_span_id(self, span):
        """Safely get span identifier."""
        for attr in ['span_id', 'id', 'trace_id']:
            if hasattr(span, attr):
                return getattr(span, attr)
        return None

    def _print_handoff_chain(self, indent=""):
        """Print the current handoff chain."""
        if self.handoff_chain:
            print(f"{indent}Current Handoff Chain:")
            print(f"{indent}  {' -> '.join(self.handoff_chain)}")

    def _print_message_flow(self, indent=""):
        """Print the message flow history."""
        if self.message_flow:
            print(f"{indent}Message Flow History:")
            for msg in self.message_flow:
                print(f"{indent}  {msg}")

    def on_trace_start(self, trace):
        """Called when a trace starts."""
        separator = "="*100
        print("\n" + separator)
        print("🚀 TRACE START")
        print(f"Name: {trace.name}")
        print(f"ID: {trace.trace_id}")
        if trace.metadata:
            print("\nMetadata:")
            for key, value in trace.metadata.items():
                print(f"  {key}: {value}")
        print(separator + "\n")
        
        # Reset tracking for new trace
        self.handoff_chain = []
        self.message_flow = []

    def on_trace_end(self, trace):
        """Called when a trace ends."""
        separator = "="*100
        print("\n" + separator)
        print("✅ TRACE END")
        print(f"Name: {trace.name}")
        print(f"ID: {trace.trace_id}")
        
        # Print final chain state
        print("\nFinal State:")
        self._print_handoff_chain("  ")
        self._print_message_flow("  ")
        
        print(separator + "\n")
        
        # Clear tracking
        self.span_depth.clear()
        self.handoff_chain = []
        self.message_flow = []

    def on_span_start(self, span):
        """Called when a span starts."""
        try:
            indent = "  " * self._get_indent_level(span)
            start_time = self._format_time(span.started_at)
            span_id = self._get_span_id(span)
            
            # Track span depth
            if span.parent_id and span_id:
                self.span_depth[span_id] = span.parent_id

            # Print span header with clear section separator
            print(f"\n{indent}{'>'*40}")
            print(f"{indent}▶ [{start_time}] {span.span_data.type.upper()} SPAN START")
            print(f"{indent}  ID: {span_id}")
            print(f"{indent}  Parent ID: {span.parent_id}")
            
            data = span.span_data.export()
            
            # Print span-specific information
            if span.span_data.type == "agent":
                agent_name = data.get('name', 'Unknown')
                print(f"{indent}  Agent: {agent_name}")
                print(f"{indent}  Handoffs: {', '.join(data.get('handoffs', []))}")
                
                # Track agent in handoff chain
                if agent_name not in self.handoff_chain:
                    self.handoff_chain.append(agent_name)
                self._print_handoff_chain(indent + "  ")
                
            elif span.span_data.type == "generation":
                print(f"{indent}  Model: {data.get('model', 'Unknown')}")
                messages = data.get('messages', [])
                if messages:
                    print(f"{indent}  Messages: {len(messages)} message(s)")
                    
            elif span.span_data.type == "function":
                print(f"{indent}  Function: {data.get('name', 'Unknown')}")
                args = data.get('arguments')
                if args:
                    print(f"{indent}  Arguments: {args}")
                    
            elif span.span_data.type == "handoff":
                from_agent = data.get('from_agent', 'Unknown')
                to_agent = data.get('to_agent', 'Unknown')
                print(f"{indent}  From: {from_agent}")
                print(f"{indent}  To: {to_agent}")
                
                # Track handoff in message flow
                flow_msg = f"{from_agent} -> {to_agent}"
                self.message_flow.append(flow_msg)
                print(f"{indent}  Message Flow:")
                for msg in self.message_flow[-3:]:  # Show last 3 flows
                    print(f"{indent}    {msg}")
                
            print(f"{indent}{'>'*40}")
                
        except Exception as e:
            print(f"\n❌ Error in on_span_start: {str(e)}")
            import traceback
            print(traceback.format_exc())

    def on_span_end(self, span):
        """Called when a span ends."""
        try:
            indent = "  " * self._get_indent_level(span)
            end_time = self._format_time(span.ended_at)
            duration = self._calculate_duration(span.started_at, span.ended_at)
            
            # Print span end information with clear section separator
            print(f"\n{indent}{'<'*40}")
            print(f"{indent}◀ [{end_time}] {span.span_data.type.upper()} SPAN END")
            print(f"{indent}  Duration: {duration:.3f}s")
            
            data = span.span_data.export()
            
            # Print span-specific output
            if span.span_data.type == "generation":
                output = data.get('output')
                if output:
                    print(f"{indent}  Output: {str(output)[:200]}...")
                    
            elif span.span_data.type == "function":
                output = data.get('output')
                if output:
                    print(f"{indent}  Output: {str(output)[:200]}...")
            
            elif span.span_data.type == "handoff":
                self._print_handoff_chain(indent + "  ")
                self._print_message_flow(indent + "  ")
            
            print(f"{indent}{'<'*40}")
            
            # Clean up span depth tracking
            span_id = self._get_span_id(span)
            if span_id and span_id in self.span_depth:
                del self.span_depth[span_id]
                
        except Exception as e:
            print(f"\n❌ Error in on_span_end: {str(e)}")
            import traceback
            print(traceback.format_exc())

    def shutdown(self):
        """Called when the processor is shutting down."""
        self.span_depth.clear()
        self.handoff_chain = []
        self.message_flow = []

    def force_flush(self):
        """Called to force flush any buffered traces/spans."""
        pass 